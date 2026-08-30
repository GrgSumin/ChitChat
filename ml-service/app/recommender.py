"""Orchestrates the three scorers into one ranked list."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app import hybrid
from app.config import MMR_LAMBDA, MMR_POOL
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
        self.authors: np.ndarray | None = None

        self.cf: BPRMatrixFactorization | None = None
        self.content: ContentScorer | None = None
        self.popularity: PopularityScorer | None = None

        self.profiles: dict[str, np.ndarray] = {}
        self.engaged: dict[str, set[str]] = {}
        self.follows: dict[str, set[str]] = {}
        self.n_interactions: dict[str, int] = {}

        self._content_matrix_ready = False
        self._popularity_vec: np.ndarray | None = None
        self._cf_col_for_post: np.ndarray | None = None

    def fit(self, snapshot: Snapshot, verbose: bool = True):
        posts = snapshot.posts
        self.post_ids = [p.post_id for p in posts]
        self.post_index = {pid: n for n, pid in enumerate(self.post_ids)}
        self.authors = np.array([p.author_id for p in posts], dtype=object)

        if verbose:
            print("Training BPR-MF...")
        self.cf = BPRMatrixFactorization().fit(snapshot.interactions, verbose=verbose)

        self._cf_col_for_post = np.array(
            [self.cf.post_to_idx.get(pid, -1) for pid in self.post_ids], dtype=np.int64
        )

        if verbose:
            print("Building TF-IDF content model...")
        self.content = ContentScorer().fit(
            posts, snapshot.interactions, snapshot.user_interests
        )
        assert self.content.idx_to_post == self.post_ids, "content ordering drift"
        self.profiles = self.content.build_user_profiles()

        self.popularity = PopularityScorer().fit(posts, snapshot.interactions)
        assert self.popularity.idx_to_post == self.post_ids, "popularity ordering drift"
        self._popularity_vec = self.popularity.score_all()

        self.engaged = {}
        self.n_interactions = {}
        for x in snapshot.interactions:
            self.engaged.setdefault(x.user_id, set()).add(x.post_id)
        for uid, posts_seen in self.engaged.items():
            self.n_interactions[uid] = len(posts_seen)
        self.follows = snapshot.follows

        return self

    def _cf_vector(self, user_id: str) -> np.ndarray | None:
        """CF scores projected onto the canonical post ordering, NaN where the
        model has no evidence."""
        if self.cf is None:
            return None
        raw = self.cf.score_all(user_id)
        if raw is None:
            return None
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
        """Rank posts for a user."""
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

        scores = np.where(mask, scores, -np.inf)

        top = self._select(scores, n, user_id)
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

    def _select(self, scores: np.ndarray, n: int, user_id: str) -> np.ndarray:
        """Choose the final list, giving every interest a proportional share."""
        interests = self.profiles.get(user_id) if self.profiles else None
        labels = (
            self.content.assign_interests(interests)
            if self.content is not None
            else None
        )
        if labels is None or interests is None or len(interests) < 2:
            return self._diversify(scores, n)

        order = [int(i) for i in np.argsort(-scores) if np.isfinite(scores[i])]
        if len(order) <= n:
            return np.array(order, dtype=int)

        exact = [share * n for share, _ in interests]
        quota = [int(np.floor(e)) for e in exact]
        for idx in sorted(
            range(len(interests)), key=lambda i: -(exact[i] - quota[i])
        )[: n - sum(quota)]:
            quota[idx] += 1
        for i in range(len(interests)):
            if quota[i] == 0:
                donor = int(np.argmax(quota))
                if quota[donor] > 1:
                    quota[donor] -= 1
                    quota[i] += 1

        buckets: list[list[int]] = [[] for _ in interests]
        for i in order:
            buckets[int(labels[i])].append(i)

        chosen: list[int] = []
        for group, want in enumerate(quota):
            chosen.extend(buckets[group][:want])
        if len(chosen) < n:
            taken = set(chosen)
            chosen.extend(i for i in order if i not in taken)

        return np.array(sorted(chosen[:n], key=lambda i: -scores[i]), dtype=int)

    def _diversify(self, scores: np.ndarray, n: int) -> np.ndarray:
        """Re-rank by Maximal Marginal Relevance (Carbonell & Goldstein, 1998)."""
        order = np.argsort(-scores)
        finite = [int(i) for i in order if np.isfinite(scores[i])]
        if len(finite) <= 1 or n <= 1:
            return np.array(finite[:n], dtype=int)

        vectors = self.content.post_vectors if self.content is not None else None
        if vectors is None or vectors.shape[1] == 0 or MMR_LAMBDA >= 1.0:
            return np.array(finite[:n], dtype=int)

        pool = finite[: max(n, MMR_POOL)]
        tail = finite[len(pool):]

        rel = scores[pool].astype(float)
        lo, hi = float(rel.min()), float(rel.max())
        rel = (rel - lo) / (hi - lo) if hi - lo > 1e-12 else np.zeros_like(rel)

        pool_vectors = vectors[pool]
        selected: list[int] = [0]
        remaining = set(range(1, len(pool)))
        max_sim = pool_vectors @ pool_vectors[0]

        while remaining and len(selected) < n:
            best, best_value = -1, -np.inf
            for c in remaining:
                value = MMR_LAMBDA * rel[c] - (1.0 - MMR_LAMBDA) * max_sim[c]
                if value > best_value:
                    best, best_value = c, value
            selected.append(best)
            remaining.discard(best)
            max_sim = np.maximum(max_sim, pool_vectors @ pool_vectors[best])

        chosen = [pool[i] for i in selected]
        return np.array((chosen + tail)[:n], dtype=int)

    def _eligibility_mask(
        self, user_id: str, feed: str, exclude_engaged: bool
    ) -> np.ndarray:
        """Which posts are allowed to appear at all."""
        mask = np.ones(len(self.post_ids), dtype=bool)

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
