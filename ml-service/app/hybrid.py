"""The weighted combiner: three scorers in, one ranked list out."""

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

        now = _now()
        decay = np.ones(len(posts))
        for n, p in enumerate(posts):
            age_days = (now - _as_aware(p.created_at)).total_seconds() / 86400.0
            decay[n] = 0.5 ** (max(age_days, 0.0) / self.half_life_days)

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
    """Like min_max, but NaN marks "this scorer has no evidence for this post"."""
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
    """Pick (w_content, w_cf, w_popularity) for a user at this history depth."""
    base_content, base_cf, base_pop = base or (W_CONTENT, W_CF, W_POPULARITY)

    if n_interactions == 0:
        total = base_content + base_pop
        if total <= 0:
            return 0.0, 0.0, 0.0
        return base_content / total, 0.0, base_pop / total

    if n_interactions < COLD_START_THRESHOLD:
        ramp = n_interactions / COLD_START_THRESHOLD
        w_cf = base_cf * ramp
        spare = base_cf - w_cf
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
    """Normalise, weight and sum. All three inputs must be aligned to the SAME"""
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
