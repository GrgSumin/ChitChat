"""Content-based scoring over hashtags, using TF-IDF vectors and cosine similarity."""

from __future__ import annotations

import numpy as np

from app.config import SIGNAL_WEIGHTS
from app.data import Interaction, PostMeta

BEHAVIOUR_ALPHA = 0.7


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

        profiles: dict[str, np.ndarray] = {}
        for uid in set(behaviour) | set(declared):
            b = behaviour.get(uid)
            d = declared.get(uid)
            if b is not None and d is not None:
                vec = BEHAVIOUR_ALPHA * b + (1 - BEHAVIOUR_ALPHA) * d
            else:
                vec = b if b is not None else d
            norm = np.linalg.norm(vec)
            if norm > 0:
                profiles[uid] = vec / norm
        return profiles

    def score_all(self, profile: np.ndarray | None) -> np.ndarray:
        """Cosine similarity of the profile against every post, in `idx_to_post`"""
        n_posts = len(self.idx_to_post)
        if profile is None or self.post_vectors is None:
            return np.zeros(n_posts)
        if self.post_vectors.shape[1] == 0:
            return np.zeros(n_posts)
        return self.post_vectors @ profile
