"""
evaluate.py
-----------
Offline evaluation. This module is what turns "I built a recommender" into
"I can defend that this recommender works", which is the difference the
dissertation is marked on.

=========================  THE SPLIT  =========================
A TEMPORAL split, not a random one. Interactions are sorted by timestamp; the
oldest 80% train, the newest 20% test.

This matters more than it looks. A random split lets the model train on a
user's Friday behaviour and be tested on their Tuesday behaviour -- it has seen
the future. Every reported number comes out flattering and none of it
generalises to production, where you only ever have the past. A temporal split
reproduces the real constraint, and scores from it are lower and honest.

=========================  THE METRICS  =========================
Ranking quality (users never see a predicted score, they see an ordered list):

  precision@k -- of the k posts we showed, what fraction did they engage with?
  recall@k    -- of everything they went on to engage with, what fraction did
                 we surface in the top k?
  NDCG@k      -- like precision but position-aware: a hit at rank 1 counts for
                 more than a hit at rank 10, discounted by 1/log2(rank+1).

Beyond accuracy (Herlocker et al., 2004, argue accuracy alone is insufficient
-- a recommender that shows everyone the same ten popular posts can score well
and still be useless):

  coverage@k  -- what fraction of the catalogue ever gets recommended? A high
                 accuracy score with 2% coverage means a filter bubble.
  novelty@k   -- mean self-information -log2(p(item)) of recommended items.
                 High novelty = surfacing the long tail rather than the
                 already-popular.

=========================  THE BASELINES  =========================
The hybrid has to BEAT something, or the number means nothing:

  random      -- sanity floor. Anything not beating this is broken.
  popularity  -- the honest strong baseline, and the one that matters most.
                 It is not personalised at all. If the hybrid cannot beat
                 "show everyone the popular posts", personalisation earned
                 nothing and the project's central claim fails.
  content     -- TF-IDF hashtag similarity alone.
  cf          -- learned BPR alone.
  hybrid      -- all three combined.

READING THE RESULTS: if popularity scores near-perfect, that is not a triumph,
it is a warning that the dataset is too easy to discriminate between methods.
See the seed script's difficulty parameters.
"""

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


# --------------------------------------------------------------------------
#  SPLIT
# --------------------------------------------------------------------------
def temporal_split(
    interactions: list[Interaction], test_fraction: float = TEST_FRACTION
) -> tuple[list[Interaction], list[Interaction]]:
    """Oldest (1-f) train, newest f test. Ties broken deterministically."""
    ordered = sorted(interactions, key=lambda x: (x.created_at, x.user_id, x.post_id))
    cut = int(len(ordered) * (1.0 - test_fraction))
    return ordered[:cut], ordered[cut:]


# --------------------------------------------------------------------------
#  METRICS
# --------------------------------------------------------------------------
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

    def add(self, k: int, recommended: list[str], relevant: set[str], item_pop: dict):
        top = recommended[:k]
        hits = len(set(top) & relevant)
        self.precision.setdefault(k, []).append(hits / k if k else 0.0)
        self.recall.setdefault(k, []).append(hits / len(relevant) if relevant else 0.0)
        self.ndcg.setdefault(k, []).append(ndcg_at_k(recommended, relevant, k))
        self.recommended_items.setdefault(k, set()).update(top)
        if top:
            self.novelty.setdefault(k, []).append(
                float(np.mean([item_pop.get(pid, 0.0) for pid in top]))
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


# --------------------------------------------------------------------------
#  RANKING PER STRATEGY
# --------------------------------------------------------------------------
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


# --------------------------------------------------------------------------
#  MAIN EVALUATION
# --------------------------------------------------------------------------
def evaluate(snapshot: Snapshot | None = None, verbose: bool = True) -> dict:
    snapshot = snapshot or load_snapshot()
    train, test = temporal_split(snapshot.interactions)

    if verbose:
        print(f"Dataset: {snapshot.summary()}")
        print(f"Temporal split: {len(train)} train / {len(test)} test interactions")

    # Fit every scorer on TRAIN ONLY. Using the full snapshot here would leak
    # the test interactions into the model and inflate every number below.
    train_snapshot = Snapshot(
        interactions=train,
        posts=snapshot.posts,
        hashtags=snapshot.hashtags,
        user_interests=snapshot.user_interests,
        follows=snapshot.follows,
        user_ids=snapshot.user_ids,
    )
    rec = Recommender().fit(train_snapshot, verbose=verbose)

    # Ground truth: what each user engaged with in the held-out period.
    relevant_by_user: dict[str, set[str]] = {}
    for x in test:
        relevant_by_user.setdefault(x.user_id, set()).add(x.post_id)

    # Item self-information for the novelty metric, computed on TRAIN.
    total = max(len(train), 1)
    counts: dict[str, int] = {}
    for x in train:
        counts[x.post_id] = counts.get(x.post_id, 0) + 1
    item_pop = {
        pid: float(-np.log2(c / total)) for pid, c in counts.items() if c > 0
    }

    catalogue = len(rec.post_ids)
    max_k = max(EVAL_KS)
    rng = np.random.default_rng(SEED)

    # Only evaluate users who actually have held-out ground truth AND whose
    # relevant posts are in the catalogue -- otherwise recall is undefined.
    eval_users = [u for u, r in relevant_by_user.items() if r]
    if verbose:
        print(f"Evaluating {len(eval_users)} users with held-out interactions\n")

    results: dict[str, dict] = {}
    for strategy in STRATEGIES:
        acc = MetricAccumulator()
        for user_id in eval_users:
            scores = _scores_for(rec, user_id, strategy, rng)

            # Candidate filtering must match serving: no own posts, and no
            # posts already engaged with during TRAIN (recommending those
            # would be trivially "correct" and meaningless).
            mask = rec._eligibility_mask(user_id, feed="home", exclude_engaged=True)
            scores = np.where(mask, scores, -np.inf)

            order = np.argsort(-scores)[:max_k]
            ranked = [rec.post_ids[i] for i in order if np.isfinite(scores[i])]
            for k in EVAL_KS:
                acc.add(k, ranked, relevant_by_user[user_id], item_pop)

        results[strategy] = {
            str(k): acc.summarise(k, catalogue) for k in EVAL_KS
        }

    payload = {
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
        print(format_table(payload))
        print(interpret(payload))

    # evaluate.py can be run before train.py has ever created models/, so make
    # sure the directory exists rather than losing the results at the last step.
    os.makedirs(os.path.dirname(METRICS_PATH), exist_ok=True)
    with open(METRICS_PATH, "w") as f:
        json.dump(payload, f, indent=2)

    return payload


# --------------------------------------------------------------------------
#  REPORTING
# --------------------------------------------------------------------------
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
    """
    Flags the two failure modes that would invalidate the results, so they are
    caught during development rather than in a viva.
    """
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
    evaluate()
