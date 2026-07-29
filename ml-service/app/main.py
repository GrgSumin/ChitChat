"""
main.py
-------
The serving layer: a FastAPI app that holds a trained Recommender in memory and
answers ranking queries in milliseconds.

    GET  /health                  is the service up, and is a model loaded?
    GET  /recommend/{user_id}     ranked post ids for a user
    GET  /similar/{post_id}       "more like this" via learned post vectors
    GET  /metrics                 last offline evaluation
    POST /train                   retrain now

=========================  WHAT THIS RETURNS  =========================
Ranked post IDs and scores -- NOT post content. The Next.js app hydrates the
actual rows through Prisma using `getPostDataInclude`, so the permission rules,
select shapes and relation counts stay defined in exactly one place. Duplicating
that shape here would guarantee the two drift apart.

=========================  CONCURRENCY  =========================
Retraining rebinds `_state.rec` to a NEWLY built Recommender rather than
mutating the live one. Readers therefore always see a fully consistent model:
either the old one or the new one, never a half-retrained hybrid. This is why
no lock is needed on the read path, which is the hot one.
"""

from __future__ import annotations

import json
import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import (
    METRICS_PATH,
    RETRAIN_INTERVAL_SECONDS,
    RETRAIN_ON_STARTUP,
)
from app.recommender import Recommender
from app.train import train


class _State:
    """Mutable service state, deliberately kept in one object so the retrain
    thread has a single well-defined thing to swap."""

    def __init__(self):
        self.rec: Recommender | None = None
        self.trained_at: float | None = None
        self.training: bool = False
        self.last_error: str | None = None


_state = _State()
_train_lock = threading.Lock()


def _retrain() -> None:
    """Train and atomically publish. Never raises into the caller's thread."""
    if not _train_lock.acquire(blocking=False):
        return  # a training run is already in flight; skip this tick
    try:
        _state.training = True
        rec = train(verbose=False)
        _state.rec = rec  # atomic rebind -- see module docstring
        _state.trained_at = time.time()
        _state.last_error = None
    except Exception as exc:  # noqa: BLE001 - a failed retrain must not kill the service
        _state.last_error = f"{type(exc).__name__}: {exc}"
        print(f"[ml] retrain failed: {_state.last_error}")
    finally:
        _state.training = False
        _train_lock.release()


def _retrain_loop(stop: threading.Event) -> None:
    while not stop.wait(RETRAIN_INTERVAL_SECONDS):
        _retrain()


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = threading.Event()

    if RETRAIN_ON_STARTUP:
        # Synchronous: the service should not report healthy while it still has
        # nothing to serve.
        _retrain()

    thread = threading.Thread(target=_retrain_loop, args=(stop,), daemon=True)
    thread.start()
    yield
    stop.set()


app = FastAPI(title="ChitChat Recommendation Service", version="1.0", lifespan=lifespan)

# The Next.js server calls this service from the server side, so CORS is not
# strictly required -- but it keeps /docs usable from a browser during
# development. Tighten allow_origins before any real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": _state.rec is not None,
        "training": _state.training,
        "trained_at": _state.trained_at,
        "age_seconds": (
            round(time.time() - _state.trained_at, 1) if _state.trained_at else None
        ),
        "posts": len(_state.rec.post_ids) if _state.rec else 0,
        "last_error": _state.last_error,
    }


@app.get("/recommend/{user_id}")
def recommend(
    user_id: str,
    feed: str = Query("home", pattern="^(home|explore)$"),
    n: int = Query(200, ge=1, le=1000),
):
    rec = _state.rec
    if rec is None:
        # 503 rather than an empty list: the caller must be able to tell
        # "no model yet" apart from "no recommendations for you", because the
        # first should trigger its reverse-chronological fallback.
        raise HTTPException(503, "Model not trained yet.")

    scored, weights = rec.recommend(user_id, feed=feed, n=n)
    return {
        "userId": user_id,
        "feed": feed,
        "weights": weights,
        "count": len(scored),
        "coldStart": user_id not in rec.n_interactions,
        "postIds": [s.post_id for s in scored],
        "scores": [round(s.score, 6) for s in scored],
    }


@app.get("/similar/{post_id}")
def similar(post_id: str, n: int = Query(10, ge=1, le=50)):
    rec = _state.rec
    if rec is None or rec.cf is None:
        raise HTTPException(503, "Model not trained yet.")
    pairs = rec.cf.similar_posts(post_id, n=n)
    if not pairs and post_id not in rec.cf.post_to_idx:
        raise HTTPException(404, f"Post {post_id} is not in the trained model.")
    return {
        "postId": post_id,
        "similar": [{"postId": p, "similarity": round(s, 6)} for p, s in pairs],
    }


@app.get("/metrics")
def metrics():
    """Last offline evaluation, produced by `python -m app.evaluate`."""
    if not os.path.exists(METRICS_PATH):
        raise HTTPException(404, "No metrics yet. Run `python -m app.evaluate`.")
    with open(METRICS_PATH) as f:
        return json.load(f)


@app.post("/train")
def trigger_train():
    if _state.training:
        return {"status": "already_training"}
    threading.Thread(target=_retrain, daemon=True).start()
    return {"status": "started"}
