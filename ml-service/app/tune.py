"""Hyper-parameter selection for the BPR model."""

from __future__ import annotations

import itertools

import numpy as np

from app import hybrid
from app.data import Snapshot, load_snapshot
from app.evaluate import ndcg_at_k, temporal_split
from app.model_cf import BPRMatrixFactorization

GRID = {
    "n_factors": [8, 16, 32],
    "reg": [0.01, 0.05, 0.1],
    "n_epochs": [30, 60],
}


def _score_config(
    inner_train, validation, posts, n_factors: int, reg: float, n_epochs: int, k: int = 10
) -> float:
    """Mean NDCG@k on the validation fold for one hyper-parameter setting."""
    try:
        model = BPRMatrixFactorization(
            n_factors=n_factors, reg=reg, n_epochs=n_epochs
        ).fit(inner_train, verbose=False)
    except ValueError:
        return 0.0

    relevant: dict[str, set[str]] = {}
    for x in validation:
        relevant.setdefault(x.user_id, set()).add(x.post_id)

    seen: dict[str, set[str]] = {}
    for x in inner_train:
        seen.setdefault(x.user_id, set()).add(x.post_id)

    scores = []
    for user_id, truth in relevant.items():
        raw = model.score_all(user_id)
        if raw is None:
            continue
        vec = hybrid.min_max(raw)
        already = seen.get(user_id, set())
        order = np.argsort(-vec)
        ranked = [
            model.idx_to_post[i]
            for i in order
            if model.idx_to_post[i] not in already
        ][:k]
        scores.append(ndcg_at_k(ranked, truth, k))

    return float(np.mean(scores)) if scores else 0.0


def tune(snapshot: Snapshot | None = None, verbose: bool = True) -> dict:
    snapshot = snapshot or load_snapshot()

    train, _test = temporal_split(snapshot.interactions)
    inner_train, validation = temporal_split(train)

    if verbose:
        print(
            f"Tuning on {len(inner_train)} inner-train / {len(validation)} "
            f"validation interactions (test set untouched)\n"
        )

    results = []
    for n_factors, reg, n_epochs in itertools.product(
        GRID["n_factors"], GRID["reg"], GRID["n_epochs"]
    ):
        ndcg = _score_config(
            inner_train, validation, snapshot.posts, n_factors, reg, n_epochs
        )
        results.append(
            {"n_factors": n_factors, "reg": reg, "n_epochs": n_epochs, "ndcg@10": ndcg}
        )
        if verbose:
            print(
                f"  k={n_factors:2d} reg={reg:<5} epochs={n_epochs:3d} "
                f"-> val NDCG@10 = {ndcg:.4f}"
            )

    best = max(results, key=lambda r: r["ndcg@10"])
    if verbose:
        print(
            f"\nBest: n_factors={best['n_factors']}, reg={best['reg']}, "
            f"n_epochs={best['n_epochs']} (val NDCG@10 = {best['ndcg@10']:.4f})"
        )
        print(
            "\nSet these in config.py (or via ML_N_FACTORS / ML_REG / "
            "ML_N_EPOCHS) before running evaluate.py."
        )
    return {"best": best, "all": results}


def tune_weights(
    snapshot: Snapshot | None = None, step: float = 0.1, k: int = 10, verbose: bool = True
) -> dict:
    """Sweep the hybrid blend weights (w_content, w_cf, w_popularity) on the SAME"""
    from app.recommender import Recommender

    snapshot = snapshot or load_snapshot()
    train, _test = temporal_split(snapshot.interactions)
    inner_train, validation = temporal_split(train)

    inner_snapshot = Snapshot(
        interactions=inner_train,
        posts=snapshot.posts,
        hashtags=snapshot.hashtags,
        user_interests=snapshot.user_interests,
        follows=snapshot.follows,
        user_ids=snapshot.user_ids,
    )
    rec = Recommender().fit(inner_snapshot, verbose=False)

    relevant: dict[str, set[str]] = {}
    for x in validation:
        relevant.setdefault(x.user_id, set()).add(x.post_id)
    eval_users = [u for u, r in relevant.items() if r]

    cached = {u: rec.component_scores(u) for u in eval_users}
    masks = {
        u: rec._eligibility_mask(u, feed="home", exclude_engaged=True)
        for u in eval_users
    }

    results = []
    steps = int(round(1.0 / step))
    for a in range(steps + 1):
        for b in range(steps + 1 - a):
            w_content = a * step
            w_cf = b * step
            w_pop = round(1.0 - w_content - w_cf, 4)
            if w_pop < -1e-9:
                continue

            scores_out = []
            for u in eval_users:
                comp = cached[u]
                cf = comp["collaborative"]
                if np.all(np.isnan(cf)):
                    cf = None
                combined, _ = hybrid.combine(
                    content=comp["content"],
                    collaborative=cf,
                    popularity=comp["popularity"],
                    n_interactions=rec.n_interactions.get(u, 0),
                    base_weights=(w_content, w_cf, w_pop),
                )
                combined = np.where(masks[u], combined, -np.inf)
                order = np.argsort(-combined)[:k]
                ranked = [
                    rec.post_ids[i] for i in order if np.isfinite(combined[i])
                ]
                scores_out.append(ndcg_at_k(ranked, relevant[u], k))

            results.append(
                {
                    "w_content": round(w_content, 2),
                    "w_cf": round(w_cf, 2),
                    "w_popularity": round(w_pop, 2),
                    f"ndcg@{k}": float(np.mean(scores_out)) if scores_out else 0.0,
                }
            )

    best = max(results, key=lambda r: r[f"ndcg@{k}"])
    if verbose:
        print(f"Swept {len(results)} weight combinations on the validation fold.\n")
        print("Top 10 by validation NDCG@%d:" % k)
        print("| w_content | w_cf | w_popularity | NDCG@%d |" % k)
        print("|---|---|---|---|")
        for r in sorted(results, key=lambda r: -r[f"ndcg@{k}"])[:10]:
            print(
                f"| {r['w_content']:.2f} | {r['w_cf']:.2f} | "
                f"{r['w_popularity']:.2f} | {r[f'ndcg@{k}']:.4f} |"
            )
        print(
            f"\nBest: ML_W_CONTENT={best['w_content']} ML_W_CF={best['w_cf']} "
            f"ML_W_POPULARITY={best['w_popularity']}"
        )
    return {"best": best, "all": results}


if __name__ == "__main__":
    import sys

    if "--weights" in sys.argv:
        tune_weights()
    else:
        tune()
