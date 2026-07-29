"""
model_content.py
----------------
Content-based scoring over hashtags, using TF-IDF vectors and cosine similarity.

=========================  WHY THIS EXISTS  =========================
BPR (model_cf.py) is the stronger scorer, but it has a hard structural limit:
a post with no interactions has a latent vector that was never trained, so its
score is meaningless. On a social feed that is not an edge case -- it is EVERY
NEW POST, which is precisely the content users most want to see. This is the
item cold-start problem (Adomavicius and Tuzhilin, 2005).

Content-based filtering has the complementary property: it can score a post the
instant it is created, because a post's hashtags place it in the feature space
immediately, with zero interactions required. That complementarity is the whole
justification for a hybrid, and it is the argument Chapter 2 of the report makes.

=========================  THE FEATURE SPACE  =========================
Each post is a sparse vector over the hashtag vocabulary, weighted TF-IDF:

    tf(t, p)  = 1 / |tags(p)|        (a 5-tag post spreads its mass thinner
                                      than a 1-tag post)
    idf(t)    = ln(N / (1 + df(t)))  (a tag on nearly every post carries
                                      almost no information)
    vector(p) = L2-normalised tf * idf

IDF matters here: without it, a near-universal tag would dominate every cosine
and the scorer would collapse toward "recommend the most-tagged posts".

=========================  THE USER PROFILE  =========================
A user is represented in the SAME space, so cosine similarity is meaningful:

    profile(u) = alpha * behavioural + (1 - alpha) * declared

  - behavioural: the signal-weighted mean of the vectors of posts they engaged
    with (a comment pulls the profile harder than a like)
  - declared: their onboarding UserInterest rows

The blend is what makes the ladder work. A brand-new user has no behaviour but
does have declared interests, so the profile is still populated -- which is how
this scorer covers USER cold-start as well as ITEM cold-start.
"""

from __future__ import annotations

import numpy as np

from app.config import SIGNAL_WEIGHTS
from app.data import Interaction, PostMeta

# How much of the profile comes from what the user DID versus what they SAID.
# Behaviour is weighted higher because stated preferences are noisy, but the
# declared half is what rescues a user with no history at all.
BEHAVIOUR_ALPHA = 0.7


class ContentScorer:
    def __init__(self):
        self.hashtag_to_idx: dict[str, int] = {}
        self.post_to_idx: dict[str, int] = {}
        self.idx_to_post: list[str] = []
        self.post_vectors: np.ndarray | None = None  # (n_posts, n_tags)
        self.idf: np.ndarray | None = None

    # ------------------------------------------------------------------ #
    #  FITTING  (no gradient descent here -- TF-IDF is a closed form)
    # ------------------------------------------------------------------ #
    def fit(
        self,
        posts: list[PostMeta],
        interactions: list[Interaction],
        user_interests: dict[str, dict[str, float]],
    ):
        # --- vocabulary ----------------------------------------------------
        tags = sorted({t for p in posts for t in p.hashtag_ids})
        self.hashtag_to_idx = {t: n for n, t in enumerate(tags)}
        self.post_to_idx = {p.post_id: n for n, p in enumerate(posts)}
        self.idx_to_post = [p.post_id for p in posts]

        n_posts, n_tags = len(posts), len(tags)
        if n_tags == 0:
            # No hashtags anywhere -- scorer degrades to "no opinion" rather
            # than crashing the whole pipeline.
            self.post_vectors = np.zeros((n_posts, 0))
            self.idf = np.zeros(0)
            self._interactions = interactions
            self._user_interests = user_interests
            return self

        # --- document frequency -> IDF -------------------------------------
        df = np.zeros(n_tags)
        for p in posts:
            for t in set(p.hashtag_ids):
                df[self.hashtag_to_idx[t]] += 1
        self.idf = np.log(n_posts / (1.0 + df))

        # --- TF-IDF matrix, L2-normalised rows ------------------------------
        mat = np.zeros((n_posts, n_tags))
        for row, p in enumerate(posts):
            if not p.hashtag_ids:
                continue
            tf = 1.0 / len(p.hashtag_ids)
            for t in p.hashtag_ids:
                mat[row, self.hashtag_to_idx[t]] += tf
        mat *= self.idf
        self.post_vectors = self._l2_normalise(mat)

        # Kept so user profiles can be rebuilt on demand.
        self._interactions = interactions
        self._user_interests = user_interests
        return self

    @staticmethod
    def _l2_normalise(mat: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        # Zero-vector rows (posts with no tags) stay zero rather than becoming
        # NaN -- they simply score 0 against everything, which is correct.
        norms[norms == 0] = 1.0
        return mat / norms

    # ------------------------------------------------------------------ #
    #  USER PROFILES
    # ------------------------------------------------------------------ #
    def build_user_profiles(self) -> dict[str, np.ndarray]:
        """Precompute every user's profile vector once per training run."""
        if self.post_vectors is None or self.post_vectors.shape[1] == 0:
            return {}
        n_tags = self.post_vectors.shape[1]

        # --- behavioural half ---------------------------------------------
        behaviour: dict[str, np.ndarray] = {}
        weight_sum: dict[str, float] = {}
        for x in self._interactions:
            row = self.post_to_idx.get(x.post_id)
            if row is None:
                continue
            w = SIGNAL_WEIGHTS.get(x.kind, 1.0)
            if x.user_id not in behaviour:
                behaviour[x.user_id] = np.zeros(n_tags)
                weight_sum[x.user_id] = 0.0
            behaviour[x.user_id] += w * self.post_vectors[row]
            weight_sum[x.user_id] += w
        for uid in behaviour:
            if weight_sum[uid] > 0:
                behaviour[uid] /= weight_sum[uid]

        # --- declared half -------------------------------------------------
        declared: dict[str, np.ndarray] = {}
        for uid, tag_scores in self._user_interests.items():
            vec = np.zeros(n_tags)
            for tag_id, score in tag_scores.items():
                col = self.hashtag_to_idx.get(tag_id)
                if col is not None:
                    vec[col] = score
            if vec.any():
                vec *= self.idf
                declared[uid] = vec / np.linalg.norm(vec)

        # --- blend ----------------------------------------------------------
        profiles: dict[str, np.ndarray] = {}
        for uid in set(behaviour) | set(declared):
            b = behaviour.get(uid)
            d = declared.get(uid)
            if b is not None and d is not None:
                vec = BEHAVIOUR_ALPHA * b + (1 - BEHAVIOUR_ALPHA) * d
            else:
                # Only one half available: use it at full strength rather than
                # scaling it down, which would understate a cold user's profile.
                vec = b if b is not None else d
            norm = np.linalg.norm(vec)
            if norm > 0:
                profiles[uid] = vec / norm
        return profiles

    # ------------------------------------------------------------------ #
    #  SCORING
    # ------------------------------------------------------------------ #
    def score_all(self, profile: np.ndarray | None) -> np.ndarray:
        """
        Cosine similarity of the profile against every post, in `idx_to_post`
        order. Both sides are already L2-normalised, so the dot product IS the
        cosine. Returns zeros for a user with no profile at all.
        """
        n_posts = len(self.idx_to_post)
        if profile is None or self.post_vectors is None:
            return np.zeros(n_posts)
        if self.post_vectors.shape[1] == 0:
            return np.zeros(n_posts)
        return self.post_vectors @ profile
