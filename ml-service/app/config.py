"""
config.py
---------
Every tunable in one place, all overridable by environment variable.

WHY this matters for the dissertation: the hybrid weights and the BPR
hyper-parameters are exactly the knobs a sensitivity analysis varies. Keeping
them here means the evaluation chapter can sweep them without touching code.
"""

import os

# ---------------------------------------------------------------- database --
# The ML service reads Postgres DIRECTLY (psycopg). It never goes through
# Prisma -- Prisma is the web app's ORM, and the ranking path deliberately
# does not depend on it.
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5433/chitchat"
)

# ------------------------------------------------------------ model layout --
MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
MODEL_PATH = os.path.join(MODEL_DIR, "model.npz")
METRICS_PATH = os.path.join(MODEL_DIR, "metrics.json")

# --------------------------------------------------------- BPR hyperparams --
# These are NOT arbitrary defaults. They were selected by grid search in
# tune.py, scored on a validation fold carved out of the TRAINING data so the
# test set stayed untouched.
#
# The right capacity depends on how much data there is, and the sweep shows it
# clearly: on a sparse ~1.2k-interaction dataset k=32 memorised the training
# set (AUC 1.000) and ranked poorly, with k=16 scoring ~3x better. After the
# seed was made denser (~4.5k interactions, ~6.8% matrix density) the extra
# capacity pays for itself and k=32 wins, at ~3x the validation NDCG@10 of the
# sparse configuration.
# ALWAYS re-run `python -m app.tune` after changing the dataset size.
N_FACTORS = int(os.getenv("ML_N_FACTORS", 32))  # latent vector width (k)
N_EPOCHS = int(os.getenv("ML_N_EPOCHS", 60))  # passes over the triple sampler
LEARNING_RATE = float(os.getenv("ML_LR", 0.05))
REGULARIZATION = float(os.getenv("ML_REG", 0.01))
SEED = int(os.getenv("ML_SEED", 42))

# How many negative samples to draw per positive interaction, per epoch.
NEG_SAMPLES = int(os.getenv("ML_NEG_SAMPLES", 4))

# ---------------------------------------------------- interaction weighting --
# Not all engagement means the same thing. A comment costs the user far more
# effort than a like, so it is stronger evidence of interest. These weights
# drive how often a positive is sampled during BPR training.
SIGNAL_WEIGHTS = {
    "like": float(os.getenv("ML_W_LIKE", 1.0)),
    "bookmark": float(os.getenv("ML_W_BOOKMARK", 1.5)),
    "comment": float(os.getenv("ML_W_COMMENT", 2.0)),
}

# ------------------------------------------------------------ hybrid blend --
# score = W_CONTENT * content + W_CF * collaborative + W_POPULARITY * popularity
# Each component is min-max normalised to [0,1] first, otherwise these weights
# would be meaningless (you cannot add a cosine to a raw like-count).
#
# Fitted by `python -m app.tune --weights` on the validation fold, NOT guessed.
# The first guess (0.30 / 0.55 / 0.15) scored WORSE than its own content
# component alone -- a hybrid that loses to one of its parts is worth knowing
# about, and is exactly what a weight sweep is for.
#
# The fitted split is an honest result about this dataset: hashtag-based
# content similarity carries most of the signal, and CF earns only 0.10 because
# ~6.8% matrix density still leaves it comparatively weak. Expect CF's share to
# rise on denser, more realistic interaction data -- re-run the sweep if the
# dataset changes.
W_CONTENT = float(os.getenv("ML_W_CONTENT", 0.50))
W_CF = float(os.getenv("ML_W_CF", 0.10))
W_POPULARITY = float(os.getenv("ML_W_POPULARITY", 0.40))

# Popularity half-life in days for the exponential recency decay.
POPULARITY_HALF_LIFE_DAYS = float(os.getenv("ML_POP_HALF_LIFE", 3.0))

# --------------------------------------------------------------- cold start --
# Below this many interactions a user's learned CF vector is not trustworthy,
# so the blend leans on content + popularity instead. See hybrid.py.
COLD_START_THRESHOLD = int(os.getenv("ML_COLD_START_THRESHOLD", 5))

# ------------------------------------------------------------- retraining ---
RETRAIN_INTERVAL_SECONDS = int(os.getenv("ML_RETRAIN_INTERVAL", 900))  # 15 min
RETRAIN_ON_STARTUP = os.getenv("ML_RETRAIN_ON_STARTUP", "true").lower() == "true"

# ------------------------------------------------------------- evaluation ---
TEST_FRACTION = float(os.getenv("ML_TEST_FRACTION", 0.2))
EVAL_KS = [5, 10, 20]
