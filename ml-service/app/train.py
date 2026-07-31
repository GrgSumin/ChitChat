"""Training entrypoint: builds a Recommender from a fresh snapshot and saves it."""

from __future__ import annotations

import os
import sys
import time

from app.config import MODEL_DIR, MODEL_PATH
from app.data import load_snapshot
from app.recommender import Recommender


def train(verbose: bool = True) -> Recommender:
    os.makedirs(MODEL_DIR, exist_ok=True)

    started = time.time()
    snapshot = load_snapshot()
    if verbose:
        print(f"Snapshot: {snapshot.summary()}")

    rec = Recommender().fit(snapshot, verbose=verbose)

    if rec.cf is not None:
        rec.cf.save(MODEL_PATH)
        if verbose:
            print(f"Saved BPR factors -> {MODEL_PATH}")

    if verbose:
        print(f"Training completed in {time.time() - started:.1f}s")
    return rec


if __name__ == "__main__":
    train()
    if "--evaluate" in sys.argv:
        from app.evaluate import evaluate

        print("\n" + "=" * 60)
        evaluate()
