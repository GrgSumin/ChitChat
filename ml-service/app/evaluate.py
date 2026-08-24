"""Offline evaluation: temporal split, ranking metrics, and baseline comparison."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import numpy as np

from app import hybrid
from app.config import EVAL_KS, METRICS_PATH, SEED, TEST_FRACTION
from app.data import Interaction, Snapshot, load_snapshot
from app.recommender import Recommender

STRATEGIES = ["random", "popularity", "content", "cf", "hybrid"]


def temporal_split(
    interactions: list[Interaction], test_fraction: float = TEST_FRACTION
) -> tuple[list[Interaction], list[Interaction]]:
    """Oldest (1-f) train, newest f test. Ties broken deterministically."""
    ordered = sorted(interactions, key=lambda x: (x.created_at, x.user_id, x.post_id))
    cut = int(len(ordered) * (1.0 - test_fraction))
    return ordered[:cut], ordered[cut:]


def dcg(relevances: list[int]) -> float:
    return sum(r / np.log2(rank + 2) for rank, r in enumerate(relevances))


def ndcg_at_k(recommended: list[str], relevant: set[str], k: int) -> float:
    gains = [1 if pid in relevant else 0 for pid in recommended[:k]]
    ideal = [1] * min(len(relevant), k)
    denom = dcg(ideal)
    return dcg(gains) / denom if denom > 0 else 0.0


@dataclass
class MetricAccumulator:
    precision: dict[int, list[float]] = field(default_factory=dict)
    recall: dict[int, list[float]] = field(default_factory=dict)
    ndcg: dict[int, list[float]] = field(default_factory=dict)
    recommended_items: dict[int, set[str]] = field(default_factory=dict)
    novelty: dict[int, list[float]] = field(default_factory=dict)

    def add(
        self,
        k: int,
        recommended: list[str],
        relevant: set[str],
        item_pop: dict,
        max_novelty: float = 0.0,
    ):
        top = recommended[:k]
        hits = len(set(top) & relevant)
        self.precision.setdefault(k, []).append(hits / k if k else 0.0)
        self.recall.setdefault(k, []).append(hits / len(relevant) if relevant else 0.0)
        self.ndcg.setdefault(k, []).append(ndcg_at_k(recommended, relevant, k))
        self.recommended_items.setdefault(k, set()).update(top)
        if top:
            # A post with no training interactions is the MOST novel thing we can
            # recommend, not the least -- defaulting to 0.0 would read as
            # "maximally popular" and understate the novelty of exploratory lists.
            self.novelty.setdefault(k, []).append(
                float(np.mean([item_pop.get(pid, max_novelty) for pid in top]))
            )

    def summarise(self, k: int, catalogue_size: int) -> dict[str, float]:
        return {
            "precision": round(float(np.mean(self.precision.get(k, [0.0]))), 4),
            "recall": round(float(np.mean(self.recall.get(k, [0.0]))), 4),
            "ndcg": round(float(np.mean(self.ndcg.get(k, [0.0]))), 4),
            "coverage": round(
                len(self.recommended_items.get(k, set())) / max(catalogue_size, 1), 4
            ),
            "novelty": round(float(np.mean(self.novelty.get(k, [0.0]))), 4),
        }


def _scores_for(
    rec: Recommender, user_id: str, strategy: str, rng: np.random.Generator
) -> np.ndarray:
    n = len(rec.post_ids)
    comp = rec.component_scores(user_id)

    if strategy == "random":
        return rng.random(n)
    if strategy == "popularity":
        return hybrid.min_max(comp["popularity"])
    if strategy == "content":
        return hybrid.min_max(comp["content"])
    if strategy == "cf":
        return hybrid.min_max_missing(comp["collaborative"])
    if strategy == "hybrid":
        cf = comp["collaborative"]
        if np.all(np.isnan(cf)):
            cf = None
        scores, _ = hybrid.combine(
            content=comp["content"],
            collaborative=cf,
            popularity=comp["popularity"],
            n_interactions=rec.n_interactions.get(user_id, 0),
        )
        return scores
    raise ValueError(f"unknown strategy {strategy}")


def holdout_auc(
    model,
    train: list[Interaction],
    test: list[Interaction],
    n_negatives: int = 100,
    seed: int = SEED,
) -> dict:
    """Fraction of (held-out positive, random negative) pairs the CF model ranks
    the right way round.

    BPR optimises pairwise order, so AUC measures exactly what it is trained to
    do -- unlike precision@k, which only inspects the head of the list. This is
    the TEST counterpart of `BPRMatrixFactorization._train_auc`: that one scores
    pairs the model fitted on and is therefore optimistically biased, so the two
    should never be quoted interchangeably.
    """
    # A post the user touched in EITHER split is a true positive. Sampling one as
    # a "negative" would penalise the model for being right, so both splits feed
    # the exclusion set.
    touched: dict[str, set[str]] = {}
    for x in train + test:
        touched.setdefault(x.user_id, set()).add(x.post_id)

    rng = np.random.default_rng(seed)
    n_posts = len(model.idx_to_post)
    wins = comparisons = skipped = 0

    for x in test:
        scores = model.score_all(x.user_id)
        col = model.post_to_idx.get(x.post_id)
        # Cold-start user, or a post created after the training cut -- the model
        # has no vector for it, so there is nothing to score.
        if scores is None or col is None:
            skipped += 1
            continue
        positive = scores[col]
        seen = touched.get(x.user_id, ())
        for _ in range(n_negatives):
            j = int(rng.integers(0, n_posts))
            if model.idx_to_post[j] in seen:
                continue
            comparisons += 1
            wins += positive > scores[j]

    return {
        "auc": round(wins / comparisons, 4) if comparisons else 0.0,
        "comparisons": comparisons,
        "skipped_test_rows": skipped,
    }


def evaluate(
    snapshot: Snapshot | None = None, verbose: bool = True, full: bool = False
) -> dict:
    snapshot = snapshot or load_snapshot()
    train, test = temporal_split(snapshot.interactions)

    if verbose:
        print(f"Dataset: {snapshot.summary()}")
        print(f"Temporal split: {len(train)} train / {len(test)} test interactions")

    train_snapshot = Snapshot(
        interactions=train,
        posts=snapshot.posts,
        hashtags=snapshot.hashtags,
        user_interests=snapshot.user_interests,
        follows=snapshot.follows,
        user_ids=snapshot.user_ids,
    )
    rec = Recommender().fit(train_snapshot, verbose=verbose)

    relevant_by_user: dict[str, set[str]] = {}
    for x in test:
        relevant_by_user.setdefault(x.user_id, set()).add(x.post_id)

    total = max(len(train), 1)
    counts: dict[str, int] = {}
    for x in train:
        counts[x.post_id] = counts.get(x.post_id, 0) + 1
    item_pop = {
        pid: float(-np.log2(c / total)) for pid, c in counts.items() if c > 0
    }
    # Novelty for a post that never appeared in training: treat it as rarer than
    # anything observed, i.e. the self-information of a single hypothetical
    # interaction. Bounded rather than infinite, and never below the observed max.
    max_novelty = float(-np.log2(1.0 / (total + 1)))

    catalogue = len(rec.post_ids)
    max_k = max(EVAL_KS)
    rng = np.random.default_rng(SEED)

    eval_users = [u for u, r in relevant_by_user.items() if r]
    if verbose:
        print(f"Evaluating {len(eval_users)} users with held-out interactions\n")

    results: dict[str, dict] = {}
    for strategy in STRATEGIES:
        acc = MetricAccumulator()
        for user_id in eval_users:
            scores = _scores_for(rec, user_id, strategy, rng)

            mask = rec._eligibility_mask(user_id, feed="home", exclude_engaged=True)
            scores = np.where(mask, scores, -np.inf)

            order = np.argsort(-scores)[:max_k]
            ranked = [rec.post_ids[i] for i in order if np.isfinite(scores[i])]
            for k in EVAL_KS:
                acc.add(k, ranked, relevant_by_user[user_id], item_pop, max_novelty)

        results[strategy] = {
            str(k): acc.summarise(k, catalogue) for k in EVAL_KS
        }

    auc = (
        holdout_auc(rec.cf, train, test)
        if rec.cf is not None
        else {"auc": 0.0, "comparisons": 0, "skipped_test_rows": len(test)}
    )
    auc["train_auc"] = (
        round(rec.cf.train_auc_history[-1], 4)
        if rec.cf is not None and rec.cf.train_auc_history
        else None
    )

    payload = {
        "cf_auc": auc,
        "dataset": {
            "users": len(snapshot.user_ids),
            "posts": len(snapshot.posts),
            "interactions": len(snapshot.interactions),
            "train": len(train),
            "test": len(test),
            "evaluated_users": len(eval_users),
            "hashtags": len(snapshot.hashtags),
        },
        "results": results,
    }

    if verbose:
        print(format_report(payload))
        if full:
            print(format_full(payload))
        print(interpret(payload))

    os.makedirs(os.path.dirname(METRICS_PATH), exist_ok=True)
    with open(METRICS_PATH, "w") as f:
        json.dump(payload, f, indent=2)

    return payload


HEADLINE_K = 10


def format_report(payload: dict) -> str:
    """The two headline numbers and nothing else: accuracy, then precision.

    Everything measured still lands in metrics.json, and `--full` prints the
    complete grid; the default view stays short enough to actually read.
    """
    auc = payload["cf_auc"]
    rule = "-" * 46

    out = ["", rule, "  ACCURACY", rule]
    if auc["train_auc"] is not None:
        gap = auc["train_auc"] - auc["auc"]
        out += [
            f"  Train Accuracy:    {auc['train_auc']:.4f}",
            f"  Test Accuracy:     {auc['auc']:.4f}",
            f"  Overfitting Gap:   {gap:.4f}",
        ]

    out += ["", rule, "  RANKING", rule]

    for k in EVAL_KS:
        out += [
            "",
            f"  k = {k}",
            f"  {'':<14}{'precision':>11}{'recall':>9}{'ndcg':>9}",
        ]
        for s in STRATEGIES:
            m = payload["results"][s][str(k)]
            out.append(
                f"  {s:<14}{m['precision']:>11.4f}{m['recall']:>9.4f}"
                f"{m['ndcg']:>9.4f}"
            )

    out.append("")
    return "\n".join(out)


def format_full(payload: dict) -> str:
    """Every metric at every k -- the detail behind the headline figures."""
    d = payload["dataset"]
    rule = "=" * 66
    out = [
        "",
        rule,
        f"  FULL RANKING REPORT   ({d['evaluated_users']} users, "
        f"{d['posts']} posts, {d['train']} train / {d['test']} test)",
        rule,
    ]
    for k in EVAL_KS:
        out += [
            "",
            f"  k = {k}",
            f"  {'':<14}{'precision':>11}{'recall':>10}{'ndcg':>10}"
            f"{'coverage':>11}{'novelty':>10}",
        ]
        for s in STRATEGIES:
            m = payload["results"][s][str(k)]
            marker = " *" if s == "hybrid" else "  "
            out.append(
                f"{marker}{s:<14}{m['precision']:>11.4f}{m['recall']:>10.4f}"
                f"{m['ndcg']:>10.4f}{m['coverage']:>11.4f}{m['novelty']:>10.2f}"
            )
    out += ["", "  * the deployed model; the rows above it are baselines", ""]
    return "\n".join(out)

    out += ["", "  * the deployed model; the rows above it are baselines", ""]
    return "\n".join(out)


def format_table(payload: dict) -> str:
    """Markdown table, ready to paste into the dissertation."""
    lines = []
    for k in EVAL_KS:
        lines.append(f"\n### k = {k}\n")
        lines.append(
            "| Strategy | Precision@k | Recall@k | NDCG@k | Coverage | Novelty |"
        )
        lines.append("|---|---|---|---|---|---|")
        for s in STRATEGIES:
            m = payload["results"][s][str(k)]
            lines.append(
                f"| {s} | {m['precision']:.4f} | {m['recall']:.4f} | "
                f"{m['ndcg']:.4f} | {m['coverage']:.4f} | {m['novelty']:.2f} |"
            )
    return "\n".join(lines)


def interpret(payload: dict) -> str:
    """Flags the two failure modes that would invalidate the results, so they are"""
    k = EVAL_KS[1] if len(EVAL_KS) > 1 else EVAL_KS[0]
    res = payload["results"]
    pop = res["popularity"][str(k)]["precision"]
    hyb = res["hybrid"][str(k)]["precision"]
    rnd = res["random"][str(k)]["precision"]

    notes = ["\n--- interpretation ---"]
    if pop > 0.5:
        notes.append(
            f"WARNING: popularity-only scores {pop:.3f} precision@{k}. That is "
            "suspiciously high for a non-personalised baseline and usually means "
            "the dataset is too easy -- engagement is too tightly clustered by "
            "topic. Increase the noise//cross-topic parameters in the seed script."
        )
    if hyb <= pop:
        notes.append(
            f"WARNING: hybrid ({hyb:.3f}) does NOT beat popularity ({pop:.3f}) at "
            f"k={k}. Personalisation is currently earning nothing -- check the "
            "blend weights, or the CF model may be undertrained."
        )
    else:
        lift = (hyb - pop) / pop * 100 if pop > 0 else float("inf")
        notes.append(
            f"OK: hybrid beats popularity at k={k} "
            f"({hyb:.3f} vs {pop:.3f}, +{lift:.1f}%)."
        )
    if hyb <= rnd:
        notes.append("CRITICAL: hybrid does not beat random. Something is broken.")
    return "\n".join(notes)


if __name__ == "__main__":
    import sys

    # Apple's Accelerate BLAS raises overflow/invalid warnings on these matmuls
    # even though every factor matrix and every score vector is finite (checked:
    # 0/109 users produce a non-finite vector). They are artefacts of the vector
    # lanes it reads past the end of the array, not of the maths, and they bury
    # the actual report. Errors still surface -- only these warnings are muted.
    np.seterr(over="ignore", invalid="ignore", divide="ignore")

    evaluate(full="--full" in sys.argv)
