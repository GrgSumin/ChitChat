"""
hybrid.py
---------
The weighted combiner: three scorers in, one ranked list out.

    score(u, p) = w1 * content(u, p)
                + w2 * collaborative(u, p)
                + w3 * popularity(p)

=========================  NORMALISATION  =========================
The three components live on completely different scales. Content is a cosine
in [-1, 1]. BPR scores are unbounded reals. Popularity is a decayed count in
[0, inf). Adding them raw would let whichever happens to have the widest range
silently dominate, and the weights would mean nothing.

So each component is min-max normalised to [0, 1] across the candidate set
BEFORE combining. Only then do w1/w2/w3 express real relative importance --
which is what makes a weight-sensitivity table in the evaluation meaningful.

=========================  ON THE POPULARITY TERM  =========================
Popularity is the one component that is NOT personalised -- every user sees the
same values. Its primary job is cold start: when a user has too little history
for BPR to have learned anything about them, something has to fill the gap, and
"what other people engaged with recently" is the least-bad uninformed guess.

Its weight is fitted, not assumed, and on the current dataset the sweep lands
it higher (0.40) than the initial guess (0.15) -- worth stating plainly rather
than quietly leaving a comment claiming it is "deliberately the smallest".
What it is NOT is the mechanism of personalisation: it cannot distinguish two
users at all. evaluate.py reports popularity-only as a BASELINE precisely so
the hybrid has to prove it beats a non-personalised ranker, which it does by a
wide margin.

=========================  THE COLD-START LADDER  =========================
The blend is not fixed; it shifts with how much we actually know about a user:

  0 interactions       -> CF is untrained for them: content + popularity only
  < COLD_START_THRESHOLD -> CF is unreliable: down-weight it, lean on content
  >= threshold         -> full configured blend

Time decay uses a half-life rather than a linear penalty so that a week-old
post is not merely worse than a fresh one but exponentially so, which matches
how quickly social content actually goes stale.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np

from app.config import (
    COLD_START_THRESHOLD,
    POPULARITY_HALF_LIFE_DAYS,
    SIGNAL_WEIGHTS,
    W_CF,
    W_CONTENT,
    W_POPULARITY,
)
from app.data import Interaction, PostMeta


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: datetime) -> datetime:
    """Postgres `timestamp(3) without time zone` comes back naive; treat it as
    UTC so arithmetic against an aware `now` does not raise."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


class PopularityScorer:
    """Time-decayed engagement count. Not personalised, by design."""

    def __init__(self, half_life_days: float = POPULARITY_HALF_LIFE_DAYS):
        self.half_life_days = half_life_days
        self.idx_to_post: list[str] = []
        self.scores: np.ndarray | None = None

    def fit(self, posts: list[PostMeta], interactions: list[Interaction]):
        self.idx_to_post = [p.post_id for p in posts]
        post_to_idx = {p.post_id: n for n, p in enumerate(posts)}

        raw = np.zeros(len(posts))
        for x in interactions:
            row = post_to_idx.get(x.post_id)
            if row is not None:
                raw[row] += SIGNAL_WEIGHTS.get(x.kind, 1.0)

        # Exponential recency decay: weight halves every `half_life_days`.
        now = _now()
        decay = np.ones(len(posts))
        for n, p in enumerate(posts):
            age_days = (now - _as_aware(p.created_at)).total_seconds() / 86400.0
            decay[n] = 0.5 ** (max(age_days, 0.0) / self.half_life_days)

        # log1p compresses the heavy tail: a post with 500 likes is not 50x
        # more worth showing than one with 10, and without this the single
        # most popular post would swamp the normalised range for everything else.
        self.scores = np.log1p(raw) * decay
        return self

    def score_all(self) -> np.ndarray:
        if self.scores is None:
            return np.zeros(len(self.idx_to_post))
        return self.scores


def min_max(v: np.ndarray) -> np.ndarray:
    """Scale to [0, 1]. A flat vector maps to all-zeros (no opinion) rather
    than all-ones, so a scorer with nothing to say cannot shift the ranking."""
    if v.size == 0:
        return v
    lo, hi = float(np.min(v)), float(np.max(v))
    if not math.isfinite(lo) or not math.isfinite(hi) or hi - lo < 1e-12:
        return np.zeros_like(v)
    return (v - lo) / (hi - lo)


def min_max_missing(v: np.ndarray) -> np.ndarray:
    """
    Like min_max, but NaN marks "this scorer has no evidence for this post".

    This is the item cold-start case: BPR only ever saw posts that had at least
    one interaction, so a brand-new post has no latent vector at all. The
    question is what to do with it in the CF term.

    Filling with the minimum would actively PUNISH every new post in the
    strongest-weighted component, which would defeat the point of having a
    content scorer to rescue them. Filling with the maximum would do the
    reverse and flood the feed with untested content. So missing entries get
    0.5 -- the neutral midpoint of the normalised range. CF then expresses no
    opinion on them, and the content term is what actually differentiates them.
    """
    known = np.isfinite(v)
    if not known.any():
        return np.zeros_like(v, dtype=float)
    lo, hi = float(v[known].min()), float(v[known].max())
    if hi - lo < 1e-12:
        return np.zeros_like(v, dtype=float)
    out = np.full(v.shape, 0.5, dtype=float)
    out[known] = (v[known] - lo) / (hi - lo)
    return out


def blend_weights(
    n_interactions: int, base: tuple[float, float, float] | None = None
) -> tuple[float, float, float]:
    """
    Pick (w_content, w_cf, w_popularity) for a user at this history depth.

    `base` overrides the configured defaults -- tune.py sweeps it against a
    validation fold so the weights are fitted rather than guessed.
    """
    base_content, base_cf, base_pop = base or (W_CONTENT, W_CF, W_POPULARITY)

    if n_interactions == 0:
        # No behavioural data: CF has literally nothing to say about this user.
        # Renormalise the remaining two so the weights still sum to 1.
        total = base_content + base_pop
        if total <= 0:
            return 0.0, 0.0, 0.0
        return base_content / total, 0.0, base_pop / total

    if n_interactions < COLD_START_THRESHOLD:
        # Some data, but a latent vector fitted on <5 points is mostly noise.
        # Ramp CF in linearly instead of trusting it abruptly.
        ramp = n_interactions / COLD_START_THRESHOLD
        w_cf = base_cf * ramp
        spare = base_cf - w_cf  # redistribute proportionally to the other two
        total = base_content + base_pop
        if total <= 0:
            return 0.0, w_cf, 0.0
        return (
            base_content + spare * (base_content / total),
            w_cf,
            base_pop + spare * (base_pop / total),
        )

    return base_content, base_cf, base_pop


def combine(
    content: np.ndarray,
    collaborative: np.ndarray | None,
    popularity: np.ndarray,
    n_interactions: int,
    base_weights: tuple[float, float, float] | None = None,
) -> tuple[np.ndarray, dict[str, float]]:
    """
    Normalise, weight and sum. All three inputs must be aligned to the SAME
    post ordering -- recommender.py guarantees this by building every scorer
    against one shared, canonical post list.

    `collaborative` may contain NaN for posts BPR never saw (see
    min_max_missing), or be None entirely for a cold-start user.

    Returns (combined_scores, weights_used) so the API can explain a ranking.
    """
    w_content, w_cf, w_pop = blend_weights(n_interactions, base_weights)

    combined = w_content * min_max(content) + w_pop * min_max(popularity)
    if collaborative is not None and w_cf > 0:
        combined = combined + w_cf * min_max_missing(collaborative)
    else:
        w_cf = 0.0

    return combined, {
        "content": round(w_content, 4),
        "collaborative": round(w_cf, 4),
        "popularity": round(w_pop, 4),
    }
