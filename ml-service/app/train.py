"""
train.py
--------
Training entrypoint. Builds a Recommender from a fresh database snapshot and
persists the learned BPR parameters.

    python -m app.train            # train and save
    python -m app.train --evaluate # train, save, then run the full evaluation

WHAT IS AND IS NOT PERSISTED: only the BPR factors go to disk (model.npz).
The content and popularity scorers are cheap closed-form computations over the
current snapshot -- rebuilding them takes milliseconds and always reflects the
latest posts, whereas a stale cached copy would quietly stop recommending new
content. The expensive part is gradient descent, and that is what gets saved.
"""

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
