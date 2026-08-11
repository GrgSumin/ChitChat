"""Every tunable in one place, all overridable by environment variable."""

import os

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5433/chitchat"
)

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
MODEL_PATH = os.path.join(MODEL_DIR, "model.npz")
METRICS_PATH = os.path.join(MODEL_DIR, "metrics.json")

N_FACTORS = int(os.getenv("ML_N_FACTORS", 32))
N_EPOCHS = int(os.getenv("ML_N_EPOCHS", 60))
LEARNING_RATE = float(os.getenv("ML_LR", 0.05))
REGULARIZATION = float(os.getenv("ML_REG", 0.05))
SEED = int(os.getenv("ML_SEED", 42))

NEG_SAMPLES = int(os.getenv("ML_NEG_SAMPLES", 4))

SIGNAL_WEIGHTS = {
    "like": float(os.getenv("ML_W_LIKE", 1.0)),
    "bookmark": float(os.getenv("ML_W_BOOKMARK", 1.5)),
    "comment": float(os.getenv("ML_W_COMMENT", 2.0)),
}

W_CONTENT = float(os.getenv("ML_W_CONTENT", 0.40))
W_CF = float(os.getenv("ML_W_CF", 0.20))
W_POPULARITY = float(os.getenv("ML_W_POPULARITY", 0.40))

POPULARITY_HALF_LIFE_DAYS = float(os.getenv("ML_POP_HALF_LIFE", 3.0))

COLD_START_THRESHOLD = int(os.getenv("ML_COLD_START_THRESHOLD", 5))

RETRAIN_INTERVAL_SECONDS = int(os.getenv("ML_RETRAIN_INTERVAL", 900))
RETRAIN_ON_STARTUP = os.getenv(
    "ML_RETRAIN_ON_STARTUP", "true").lower() == "true"

TEST_FRACTION = float(os.getenv("ML_TEST_FRACTION", 0.2))
EVAL_KS = [5, 10, 20]
