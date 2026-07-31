"""Collaborative filtering: BPR-MF (Rendle et al. 2009) via the `implicit` library."""

from __future__ import annotations

import numpy as np
from implicit.bpr import BayesianPersonalizedRanking
from scipy.sparse import csr_matrix

from app.config import (
    LEARNING_RATE,
    N_EPOCHS,
    N_FACTORS,
    NEG_SAMPLES,
    REGULARIZATION,
    SEED,
)
from app.data import Interaction

MODEL_FORMAT_VERSION = 2


class BPRMatrixFactorization:
    def __init__(
        self,
        n_factors: int = N_FACTORS,
        n_epochs: int = N_EPOCHS,
        lr: float = LEARNING_RATE,
        reg: float = REGULARIZATION,
        neg_samples: int = NEG_SAMPLES,
        seed: int = SEED,
    ):
        self.n_factors = n_factors
        self.n_epochs = n_epochs
        self.lr = lr
        self.reg = reg
        self.neg_samples = neg_samples
        self.seed = seed

        self.P: np.ndarray | None = None
        self.Q: np.ndarray | None = None

        self.user_to_idx: dict[str, int] = {}
        self.post_to_idx: dict[str, int] = {}
        self.idx_to_post: list[str] = []

        self.user_positives: dict[int, set[int]] = {}

        self.train_auc_history: list[float] = []

    def fit(self, interactions: list[Interaction], verbose: bool = True):
        users = sorted({x.user_id for x in interactions})
        posts = sorted({x.post_id for x in interactions})
        self.user_to_idx = {u: n for n, u in enumerate(users)}
        self.post_to_idx = {p: n for n, p in enumerate(posts)}
        self.idx_to_post = posts
        n_users, n_posts = len(users), len(posts)

        if n_users == 0 or n_posts < 2:
            raise ValueError(
                "Not enough interaction data to train "
                f"({n_users} users, {n_posts} posts)."
            )

        pairs: set[tuple[int, int]] = set()
        for x in interactions:
            pairs.add((self.user_to_idx[x.user_id], self.post_to_idx[x.post_id]))

        pos_u = np.fromiter((u for u, _ in pairs), dtype=np.int64, count=len(pairs))
        pos_i = np.fromiter((i for _, i in pairs), dtype=np.int64, count=len(pairs))

        self.user_positives = {}
        for u, i in pairs:
            self.user_positives.setdefault(u, set()).add(i)

        matrix = csr_matrix(
            (np.ones(len(pairs), dtype=np.float32), (pos_u, pos_i)),
            shape=(n_users, n_posts),
        )

        model = BayesianPersonalizedRanking(
            factors=self.n_factors,
            learning_rate=self.lr,
            regularization=self.reg,
            iterations=self.n_epochs,
            random_state=self.seed,
            use_gpu=False,
            num_threads=1,
            verify_negative_samples=True,
        )
        model.fit(matrix, show_progress=False)

        self.P = np.asarray(model.user_factors, dtype=np.float64)
        self.Q = np.asarray(model.item_factors, dtype=np.float64)

        auc = self._train_auc(pos_u, pos_i, n_posts)
        self.train_auc_history = [auc]
        if verbose:
            print(f"  BPR trained: {n_users} users, {n_posts} posts, "
                  f"{len(pairs)} pairs, train AUC = {auc:.4f}")

        return self

    def _train_auc(
        self, pos_u: np.ndarray, pos_i: np.ndarray, n_posts: int, n_samples: int = 20_000
    ) -> float:
        """Fraction of sampled (user, positive, negative) triples the model already"""
        if self.P is None or self.Q is None or len(pos_u) == 0:
            return 0.0

        rng = np.random.default_rng(self.seed)
        idx = rng.integers(0, len(pos_u), size=min(n_samples, len(pos_u) * 10))
        u_arr, i_arr = pos_u[idx], pos_i[idx]
        j_arr = rng.integers(0, n_posts, size=len(idx))

        keep = np.array(
            [j not in self.user_positives.get(u, ()) for u, j in zip(u_arr, j_arr)]
        )
        if not keep.any():
            return 0.0
        u_arr, i_arr, j_arr = u_arr[keep], i_arr[keep], j_arr[keep]

        p_u = self.P[u_arr]
        diff = np.einsum("ij,ij->i", p_u, self.Q[i_arr] - self.Q[j_arr])
        return float((diff > 0).mean())

    def knows_user(self, user_id: str) -> bool:
        return user_id in self.user_to_idx

    def score_all(self, user_id: str) -> np.ndarray | None:
        """Scores for EVERY post the model knows, in `idx_to_post` order."""
        if self.P is None or self.Q is None or user_id not in self.user_to_idx:
            return None
        return self.Q @ self.P[self.user_to_idx[user_id]]

    def similar_posts(self, post_id: str, n: int = 10) -> list[tuple[str, float]]:
        """'More like this' via cosine similarity of learned post vectors."""
        if self.Q is None or post_id not in self.post_to_idx:
            return []
        taste = self.Q[:, :-1]
        i = self.post_to_idx[post_id]
        target = taste[i]
        norms = np.linalg.norm(taste, axis=1) * np.linalg.norm(target) + 1e-9
        sims = (taste @ target) / norms
        order = np.argsort(-sims)
        out: list[tuple[str, float]] = []
        for idx in order:
            if int(idx) == i:
                continue
            out.append((self.idx_to_post[int(idx)], float(sims[idx])))
            if len(out) >= n:
                break
        return out

    def save(self, path: str) -> None:
        """Saved as .npz rather than pickle on purpose: unpickling executes"""
        np.savez_compressed(
            path,
            format_version=MODEL_FORMAT_VERSION,
            P=self.P,
            Q=self.Q,
            user_ids=np.array(list(self.user_to_idx.keys()), dtype="U"),
            post_ids=np.array(self.idx_to_post, dtype="U"),
            n_factors=self.n_factors,
            train_auc_history=np.array(self.train_auc_history),
        )

    @classmethod
    def load(cls, path: str) -> "BPRMatrixFactorization":
        raw = np.load(path)

        version = int(raw["format_version"]) if "format_version" in raw else 1
        if version != MODEL_FORMAT_VERSION:
            raise ValueError(
                f"{path} is model format v{version}, this build expects "
                f"v{MODEL_FORMAT_VERSION}. Delete it and retrain."
            )

        model = cls(n_factors=int(raw["n_factors"]))
        model.P = raw["P"]
        model.Q = raw["Q"]
        user_ids = [str(x) for x in raw["user_ids"]]
        post_ids = [str(x) for x in raw["post_ids"]]
        model.user_to_idx = {u: n for n, u in enumerate(user_ids)}
        model.post_to_idx = {p: n for n, p in enumerate(post_ids)}
        model.idx_to_post = post_ids
        model.train_auc_history = list(raw["train_auc_history"])
        return model
