"""
recommender.py
--------------
Orchestrates the three scorers into one ranked list.

Its main job is an unglamorous but critical one: KEEPING EVERYTHING ALIGNED.
The BPR model only ever sees posts that have at least one interaction (~559 of
619 in the current dataset), while the content and popularity scorers cover all
of them. Three arrays indexed three different ways would produce a ranking that
looks plausible and is silently wrong.

So this class defines ONE canonical post ordering -- `self.post_ids`, taken
from the full post table -- and projects every scorer onto it. CF scores for
posts BPR never saw are NaN, which hybrid.min_max_missing then treats as
"no opinion" rather than as a zero.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app import hybrid
from app.data import Snapshot
from app.model_cf import BPRMatrixFactorization
from app.model_content import ContentScorer
from app.hybrid import PopularityScorer


@dataclass
class ScoredPost:
    post_id: str
    score: float
    author_id: str


class Recommender:
    def __init__(self):
        self.post_ids: list[str] = []
        self.post_index: dict[str, int] = {}
        self.authors: np.ndarray | None = None  # author id per canonical index

        self.cf: BPRMatrixFactorization | None = None
        self.content: ContentScorer | None = None
        self.popularity: PopularityScorer | None = None

        self.profiles: dict[str, np.ndarray] = {}
        self.engaged: dict[str, set[str]] = {}  # user -> posts they interacted with
        self.follows: dict[str, set[str]] = {}
        self.n_interactions: dict[str, int] = {}

        # Cached per-canonical-index views of each scorer.
        self._content_matrix_ready = False
        self._popularity_vec: np.ndarray | None = None
        self._cf_col_for_post: np.ndarray | None = None

    # ------------------------------------------------------------------ #
    #  FIT
    # ------------------------------------------------------------------ #
    def fit(self, snapshot: Snapshot, verbose: bool = True):
        posts = snapshot.posts
        self.post_ids = [p.post_id for p in posts]
        self.post_index = {pid: n for n, pid in enumerate(self.post_ids)}
        self.authors = np.array([p.author_id for p in posts], dtype=object)

        # --- collaborative --------------------------------------------------
        if verbose:
            print("Training BPR-MF...")
        self.cf = BPRMatrixFactorization().fit(snapshot.interactions, verbose=verbose)

        # Map canonical post index -> row in the CF model (-1 if CF never saw it)
        self._cf_col_for_post = np.array(
            [self.cf.post_to_idx.get(pid, -1) for pid in self.post_ids], dtype=np.int64
        )

        # --- content ---------------------------------------------------------
        if verbose:
            print("Building TF-IDF content model...")
        self.content = ContentScorer().fit(
            posts, snapshot.interactions, snapshot.user_interests
        )
        # ContentScorer was fitted on the same `posts` list, so its ordering
        # already matches ours -- assert rather than assume.
        assert self.content.idx_to_post == self.post_ids, "content ordering drift"
        self.profiles = self.content.build_user_profiles()

        # --- popularity -------------------------------------------------------
        self.popularity = PopularityScorer().fit(posts, snapshot.interactions)
        assert self.popularity.idx_to_post == self.post_ids, "popularity ordering drift"
        self._popularity_vec = self.popularity.score_all()

        # --- per-user bookkeeping ---------------------------------------------
        self.engaged = {}
        self.n_interactions = {}
        for x in snapshot.interactions:
            self.engaged.setdefault(x.user_id, set()).add(x.post_id)
        for uid, posts_seen in self.engaged.items():
            self.n_interactions[uid] = len(posts_seen)
        self.follows = snapshot.follows

        return self

    # ------------------------------------------------------------------ #
    #  SCORING
    # ------------------------------------------------------------------ #
    def _cf_vector(self, user_id: str) -> np.ndarray | None:
        """CF scores projected onto the canonical post ordering, NaN where the
        model has no evidence."""
        if self.cf is None:
            return None
        raw = self.cf.score_all(user_id)
        if raw is None:
            return None  # cold-start user: CF abstains entirely
        out = np.full(len(self.post_ids), np.nan)
        known = self._cf_col_for_post >= 0
        out[known] = raw[self._cf_col_for_post[known]]
        return out

    def component_scores(self, user_id: str) -> dict[str, np.ndarray]:
        """Exposed for evaluate.py, which needs each scorer in isolation to
        report the single-signal baselines."""
        content = self.content.score_all(self.profiles.get(user_id))
        cf = self._cf_vector(user_id)
        return {
            "content": content,
            "collaborative": cf if cf is not None else np.full(len(self.post_ids), np.nan),
            "popularity": self._popularity_vec,
        }

    def recommend(
        self,
        user_id: str,
        feed: str = "home",
        n: int = 200,
        exclude_engaged: bool = True,
    ) -> tuple[list[ScoredPost], dict[str, float]]:
        """
        Rank posts for a user.

        feed="explore" additionally drops posts by accounts the user already
        follows -- explore is for discovery, and showing followed accounts there
        would just duplicate the home feed.
        """
        if not self.post_ids:
            return [], {}

        comp = self.component_scores(user_id)
        cf = comp["collaborative"]
        if np.all(np.isnan(cf)):
            cf = None

        scores, weights = hybrid.combine(
            content=comp["content"],
            collaborative=cf,
            popularity=comp["popularity"],
            n_interactions=self.n_interactions.get(user_id, 0),
        )

        mask = self._eligibility_mask(user_id, feed, exclude_engaged)

        # -inf rather than deletion keeps indices aligned with post_ids.
        scores = np.where(mask, scores, -np.inf)

        top = np.argsort(-scores)[:n]
        return (
            [
                ScoredPost(
                    post_id=self.post_ids[i],
                    score=float(scores[i]),
                    author_id=str(self.authors[i]),
                )
                for i in top
                if np.isfinite(scores[i])
            ],
            weights,
        )

    def _eligibility_mask(
        self, user_id: str, feed: str, exclude_engaged: bool
    ) -> np.ndarray:
        """Which posts are allowed to appear at all."""
        mask = np.ones(len(self.post_ids), dtype=bool)

        # Never recommend a user their own posts.
        mask &= self.authors != user_id

        if exclude_engaged:
            seen = self.engaged.get(user_id)
            if seen:
                for pid in seen:
                    idx = self.post_index.get(pid)
                    if idx is not None:
                        mask[idx] = False

        if feed == "explore":
            followed = self.follows.get(user_id)
            if followed:
                mask &= ~np.isin(self.authors, list(followed))

        return mask
