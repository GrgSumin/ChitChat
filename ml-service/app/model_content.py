"""Content-based scoring over hashtags, using TF-IDF vectors and cosine similarity."""

from __future__ import annotations

import numpy as np

from app.config import SIGNAL_WEIGHTS
from app.data import Interaction, PostMeta

BEHAVIOUR_ALPHA = 0.7


def _unit(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 0 else vec


class ContentScorer:
    def __init__(self):
        self.hashtag_to_idx: dict[str, int] = {}
        self.post_to_idx: dict[str, int] = {}
        self.idx_to_post: list[str] = []
        self.post_vectors: np.ndarray | None = None
        self.idf: np.ndarray | None = None

    def fit(
        self,
        posts: list[PostMeta],
        interactions: list[Interaction],
        user_interests: dict[str, dict[str, float]],
    ):
        tags = sorted({t for p in posts for t in p.hashtag_ids})
        self.hashtag_to_idx = {t: n for n, t in enumerate(tags)}
        self.post_to_idx = {p.post_id: n for n, p in enumerate(posts)}
        self.idx_to_post = [p.post_id for p in posts]

        n_posts, n_tags = len(posts), len(tags)
        if n_tags == 0:
            self.post_vectors = np.zeros((n_posts, 0))
            self.idf = np.zeros(0)
            self._interactions = interactions
            self._user_interests = user_interests
            return self

        df = np.zeros(n_tags)
        for p in posts:
            for t in set(p.hashtag_ids):
                df[self.hashtag_to_idx[t]] += 1
        self.idf = np.log(n_posts / (1.0 + df))

        mat = np.zeros((n_posts, n_tags))
        for row, p in enumerate(posts):
            if not p.hashtag_ids:
                continue
            tf = 1.0 / len(p.hashtag_ids)
            for t in p.hashtag_ids:
                mat[row, self.hashtag_to_idx[t]] += tf
        mat *= self.idf
        self.post_vectors = self._l2_normalise(mat)

        self._interactions = interactions
        self._user_interests = user_interests
        return self

    @staticmethod
    def _l2_normalise(mat: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return mat / norms

    def build_user_profiles(self) -> dict[str, np.ndarray]:
        """Precompute every user's profile vector once per training run."""
        if self.post_vectors is None or self.post_vectors.shape[1] == 0:
            return {}
        n_tags = self.post_vectors.shape[1]

        engaged: dict[str, list[tuple[float, np.ndarray]]] = {}
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
                engaged[x.user_id] = []
            behaviour[x.user_id] += w * self.post_vectors[row]
            weight_sum[x.user_id] += w
            engaged[x.user_id].append((w, self.post_vectors[row]))
        for uid in behaviour:
            if weight_sum[uid] > 0:
                behaviour[uid] /= weight_sum[uid]
        self._engaged = engaged

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

        profiles: dict[str, list[tuple[float, np.ndarray]]] = {}
        for uid in set(behaviour) | set(declared):
            interests = self._split_interests(engaged.get(uid, []))

            d = declared.get(uid)
            if d is not None:
                if interests:
                    interests = [
                        (share, _unit(BEHAVIOUR_ALPHA * vec + (1 - BEHAVIOUR_ALPHA) * d))
                        for share, vec in interests
                    ]
                else:
                    interests = [(1.0, d)]

            if interests:
                profiles[uid] = interests
        return profiles

    @staticmethod
    def _split_interests(
        engaged: list[tuple[float, np.ndarray]],
        threshold: float = 0.30,
        max_interests: int = 4,
    ) -> list[tuple[float, np.ndarray]]:
        """Group a user's engagement into separate interests by similarity."""
        if not engaged:
            return []

        order = sorted(range(len(engaged)), key=lambda i: -engaged[i][0])
        sums: list[np.ndarray] = []
        totals: list[float] = []

        for i in order:
            weight, vec = engaged[i]
            best, best_sim = -1, -np.inf
            for c, acc in enumerate(sums):
                norm = np.linalg.norm(acc)
                sim = float((acc / norm) @ vec) if norm > 0 else 0.0
                if sim > best_sim:
                    best, best_sim = c, sim

            if best >= 0 and (best_sim >= threshold or len(sums) >= max_interests):
                sums[best] += weight * vec
                totals[best] += weight
            else:
                sums.append(weight * vec)
                totals.append(weight)

        total = sum(totals)
        if total <= 0:
            return []

        out: list[tuple[float, np.ndarray]] = []
        for acc, weight in zip(sums, totals):
            norm = np.linalg.norm(acc)
            if norm > 0:
                out.append((weight / total, acc / norm))
        return sorted(out, key=lambda t: -t[0])

    def score_all(
        self, profile: list[tuple[float, np.ndarray]] | np.ndarray | None
    ) -> np.ndarray:
        """Score every post against the user's best-matching interest."""
        n_posts = len(self.idx_to_post)
        if profile is None or self.post_vectors is None:
            return np.zeros(n_posts)
        if self.post_vectors.shape[1] == 0:
            return np.zeros(n_posts)

        if isinstance(profile, np.ndarray):
            return self.post_vectors @ profile

        if not profile:
            return np.zeros(n_posts)

        scores = np.full(n_posts, -np.inf)
        for share, vec in profile:
            np.maximum(scores, share * (self.post_vectors @ vec), out=scores)
        return scores

    def assign_interests(
        self, profile: list[tuple[float, np.ndarray]] | np.ndarray | None
    ) -> np.ndarray | None:
        """Label every post with the index of the interest it best matches."""
        if (
            self.post_vectors is None
            or self.post_vectors.shape[1] == 0
            or not isinstance(profile, list)
            or len(profile) < 2
        ):
            return None

        sims = np.stack([self.post_vectors @ vec for _, vec in profile])
        return np.argmax(sims, axis=0)
