"""
model_cf.py
-----------
Bayesian Personalised Ranking Matrix Factorisation (BPR-MF), implemented from
scratch in NumPy. This is the LEARNED component of the recommender -- the part
that is genuinely machine learning rather than a hand-tuned formula.

=========================  THE ALGORITHM  =========================
Every user u and every post i is represented by a latent vector of length k
that the model LEARNS. A post also gets a scalar bias b_i. The score is:

    s(u, i) = p_u . q_i + b_i

Nobody tells the model what the k dimensions mean. They are discovered from
the interaction matrix alone -- that is what makes this collaborative filtering
rather than a rule.

BPR does not try to predict a number. It optimises RANKING directly. For a
user u who engaged with post i but not with post j, we want:

    s(u, i) > s(u, j)

Writing x_uij = s(u,i) - s(u,j), BPR maximises the log-likelihood of the
observed orderings under a sigmoid, with L2 regularisation:

    maximise  SUM over sampled triples  ln σ(x_uij)  -  λ(|p_u|² + |q_i|² + |q_j|²)

Differentiating ln σ(x_uij) gives a gradient scaled by z = σ(-x_uij), which is
large when the model has the pair the WRONG way round and near zero when it
already has them comfortably ordered. So the model spends its effort on the
pairs it currently gets wrong.

    z    = σ(-x_uij)
    p_u += lr * ( z * (q_i - q_j) - λ p_u )
    q_i += lr * ( z * p_u         - λ q_i )
    q_j += lr * ( z * (-p_u)      - λ q_j )
    b_i += lr * ( z               - λ b_i )
    b_j += lr * (-z               - λ b_j )

=========================  WHY BPR  =========================
The obvious alternative -- and the model in the reference project this service
was adapted from -- is Funk-SVD, which minimises squared error against a known
rating. That is the wrong tool here for a concrete reason: ChitChat has no
ratings. A like is a 1, and the absence of a like is NOT a 0 -- it usually just
means the user never saw the post. Squared-error MF is forced to treat every
unobserved cell as a genuine negative, which biases it badly on implicit data.

BPR instead makes only the weak, defensible assumption that an engaged post is
preferred to a randomly drawn un-engaged one. It also optimises exactly the
quantity the evaluation reports -- ranking quality (precision@k) -- rather than
a rating error that users never see.

Rejected alternatives, and why:
  - Item-item KNN: O(n_posts²) similarity matrix, and it cannot generalise
    beyond co-engagement it has literally observed. Fine as a BASELINE, and
    evaluate.py includes it as one.
  - Neural CF / two-tower: more capacity, but with ~1.3k interactions it would
    overfit immediately, and it is far harder to defend in a viva than 100
    lines of visible gradient descent.
  - ALS with confidence weighting (Hu et al., 2008): a reasonable choice, but
    it optimises a pointwise objective and needs matrix inversions; BPR is
    simpler and ranks better at this data scale.

=========================  SIGNAL WEIGHTING  =========================
Likes, bookmarks and comments are not equally informative. Rather than invent
a rating scale, we let the weight control HOW OFTEN a positive is sampled: a
comment (weight 2.0) is drawn twice as often as a like (1.0), so the model sees
it twice as much evidence. This keeps the objective a clean ranking loss while
still respecting signal strength.

=========================  A NOTE ON LOCAL WARNINGS  =========================
On macOS, NumPy 2.x built against Apple's Accelerate BLAS emits spurious
"divide by zero encountered in matmul" RuntimeWarnings. They fire on clean
random data with no model involved (verifiable with a two-line repro), the
results are finite and correct, and they do not occur in the Linux container,
which uses OpenBLAS. Do not "fix" them by clamping the parameters -- there is
nothing wrong with the parameters.
"""

from __future__ import annotations

import numpy as np

from app.config import (
    LEARNING_RATE,
    N_EPOCHS,
    N_FACTORS,
    NEG_SAMPLES,
    REGULARIZATION,
    SEED,
    SIGNAL_WEIGHTS,
)
from app.data import Interaction


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

        # Learned parameters
        self.P: np.ndarray | None = None  # (n_users, k) user latent vectors
        self.Q: np.ndarray | None = None  # (n_posts, k) post latent vectors
        self.b_i: np.ndarray | None = None  # (n_posts,) post biases

        # Id <-> contiguous index maps (cuids are strings; NumPy needs ints)
        self.user_to_idx: dict[str, int] = {}
        self.post_to_idx: dict[str, int] = {}
        self.idx_to_post: list[str] = []

        # Per-user positive sets, used to avoid sampling a false negative.
        self.user_positives: dict[int, set[int]] = {}

        self.train_auc_history: list[float] = []

    # ------------------------------------------------------------------ #
    #  TRAINING
    # ------------------------------------------------------------------ #
    def fit(self, interactions: list[Interaction], verbose: bool = True):
        rng = np.random.default_rng(self.seed)

        # --- 1) Index maps -------------------------------------------------
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

        # --- 2) Positives + sampling weights -------------------------------
        # Collapse duplicate (user, post) pairs by SUMMING their weights, so a
        # post that was both liked and bookmarked outranks one merely liked.
        pair_weight: dict[tuple[int, int], float] = {}
        for x in interactions:
            u = self.user_to_idx[x.user_id]
            i = self.post_to_idx[x.post_id]
            pair_weight[(u, i)] = pair_weight.get((u, i), 0.0) + SIGNAL_WEIGHTS.get(
                x.kind, 1.0
            )

        pos_u = np.array([u for (u, _) in pair_weight], dtype=np.int64)
        pos_i = np.array([i for (_, i) in pair_weight], dtype=np.int64)
        weights = np.array(list(pair_weight.values()), dtype=np.float64)
        sample_p = weights / weights.sum()  # weighted positive sampling

        self.user_positives = {}
        for u, i in pair_weight:
            self.user_positives.setdefault(u, set()).add(i)

        # --- 3) Initialise -------------------------------------------------
        # Small random values break symmetry; biases start at zero.
        self.P = rng.normal(0, 0.1, (n_users, self.n_factors))
        self.Q = rng.normal(0, 0.1, (n_posts, self.n_factors))
        self.b_i = np.zeros(n_posts)

        n_triples = len(pos_u) * self.neg_samples

        # --- 4) SGD over sampled triples -----------------------------------
        for epoch in range(self.n_epochs):
            # Draw this epoch's positives (weighted) and uniform negatives.
            idx = rng.choice(len(pos_u), size=n_triples, p=sample_p)
            u_arr = pos_u[idx]
            i_arr = pos_i[idx]
            j_arr = rng.integers(0, n_posts, size=n_triples)

            # Resample negatives that are actually positives for that user.
            # Bounded retries: with ~600 posts and ~13 positives per user a
            # collision is rare, so a few passes clears essentially all of them.
            for _ in range(5):
                clash = np.array(
                    [
                        j in self.user_positives.get(u, ())
                        for u, j in zip(u_arr, j_arr)
                    ]
                )
                if not clash.any():
                    break
                j_arr[clash] = rng.integers(0, n_posts, size=int(clash.sum()))

            auc = self._sgd_epoch(u_arr, i_arr, j_arr)
            self.train_auc_history.append(auc)

            if verbose and (epoch % 10 == 0 or epoch == self.n_epochs - 1):
                print(f"  epoch {epoch + 1:3d}/{self.n_epochs}  train AUC = {auc:.4f}")

        return self

    def _sgd_epoch(self, u_arr, i_arr, j_arr) -> float:
        """
        One vectorised pass. Returns training AUC -- the fraction of triples
        already ranked correctly, which is BPR's natural progress measure
        (0.5 = random, 1.0 = perfect separation).

        np.add.at is used rather than `P[u] += ...` because a user can appear
        many times in one batch; plain fancy-index assignment would keep only
        the last write and silently drop most of the gradient.
        """
        P, Q, b = self.P, self.Q, self.b_i

        p_u = P[u_arr]
        q_i = Q[i_arr]
        q_j = Q[j_arr]

        x_uij = np.einsum("ij,ij->i", p_u, q_i - q_j) + b[i_arr] - b[j_arr]

        # z = sigmoid(-x); computed in a numerically stable form.
        z = np.where(
            x_uij >= 0,
            np.exp(-x_uij) / (1.0 + np.exp(-x_uij)),
            1.0 / (1.0 + np.exp(x_uij)),
        )
        z = z[:, None]  # column vector for broadcasting

        grad_p = z * (q_i - q_j) - self.reg * p_u
        grad_qi = z * p_u - self.reg * q_i
        grad_qj = -z * p_u - self.reg * q_j

        np.add.at(P, u_arr, self.lr * grad_p)
        np.add.at(Q, i_arr, self.lr * grad_qi)
        np.add.at(Q, j_arr, self.lr * grad_qj)
        np.add.at(b, i_arr, self.lr * (z[:, 0] - self.reg * b[i_arr]))
        np.add.at(b, j_arr, self.lr * (-z[:, 0] - self.reg * b[j_arr]))

        return float((x_uij > 0).mean())

    # ------------------------------------------------------------------ #
    #  SCORING
    # ------------------------------------------------------------------ #
    def knows_user(self, user_id: str) -> bool:
        return user_id in self.user_to_idx

    def score_all(self, user_id: str) -> np.ndarray | None:
        """
        Scores for EVERY post the model knows, in `idx_to_post` order.
        Returns None for a cold-start user -- the caller then leans on the
        content and popularity scorers instead of inventing a number.
        """
        if self.P is None or user_id not in self.user_to_idx:
            return None
        u = self.user_to_idx[user_id]
        return self.Q @ self.P[u] + self.b_i

    def similar_posts(self, post_id: str, n: int = 10) -> list[tuple[str, float]]:
        """'More like this' via cosine similarity of learned post vectors."""
        if self.Q is None or post_id not in self.post_to_idx:
            return []
        i = self.post_to_idx[post_id]
        target = self.Q[i]
        norms = np.linalg.norm(self.Q, axis=1) * np.linalg.norm(target) + 1e-9
        sims = (self.Q @ target) / norms
        order = np.argsort(-sims)
        out: list[tuple[str, float]] = []
        for idx in order:
            if int(idx) == i:
                continue
            out.append((self.idx_to_post[int(idx)], float(sims[idx])))
            if len(out) >= n:
                break
        return out

    # ------------------------------------------------------------------ #
    #  PERSISTENCE
    # ------------------------------------------------------------------ #
    def save(self, path: str) -> None:
        """
        Saved as .npz rather than pickle on purpose: unpickling executes
        arbitrary code, so a pickled model file is a remote-code-execution
        vector the moment anything untrusted can write to the models directory.

        Note the id arrays use dtype "U" (fixed-width unicode), NOT dtype
        object. Object arrays would round-trip through pickle internally and
        force allow_pickle=True on load, which would reintroduce precisely the
        risk this format was chosen to avoid. With "U" the file is pure numeric
        + text data and loads with allow_pickle left off.
        """
        np.savez_compressed(
            path,
            P=self.P,
            Q=self.Q,
            b_i=self.b_i,
            user_ids=np.array(list(self.user_to_idx.keys()), dtype="U"),
            post_ids=np.array(self.idx_to_post, dtype="U"),
            n_factors=self.n_factors,
            train_auc_history=np.array(self.train_auc_history),
        )

    @classmethod
    def load(cls, path: str) -> "BPRMatrixFactorization":
        # allow_pickle stays at its safe default of False -- see save().
        raw = np.load(path)
        model = cls(n_factors=int(raw["n_factors"]))
        model.P = raw["P"]
        model.Q = raw["Q"]
        model.b_i = raw["b_i"]
        user_ids = [str(x) for x in raw["user_ids"]]
        post_ids = [str(x) for x in raw["post_ids"]]
        model.user_to_idx = {u: n for n, u in enumerate(user_ids)}
        model.post_to_idx = {p: n for n, p in enumerate(post_ids)}
        model.idx_to_post = post_ids
        model.train_auc_history = list(raw["train_auc_history"])
        return model
