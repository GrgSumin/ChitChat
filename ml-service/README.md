# ChitChat Recommendation Service

A Python service that ranks posts for ChitChat's Home and Explore feeds. It is a
**separate process from the Next.js app** and reads PostgreSQL directly with
psycopg — it does not use Prisma.

Ranking is produced by a **trained model**, not a SQL popularity formula:
Bayesian Personalised Ranking matrix factorisation (BPR-MF), hand-written in
NumPy, learns latent vectors for every user and post from the like / bookmark /
comment matrix by stochastic gradient descent.

## Architecture

```
Next.js /api/posts/for-you   /api/posts/explore
   |
   |  HTTP  GET /recommend/{userId}?feed=home|explore
   v
ml-service (FastAPI + NumPy)         reads Postgres directly
   |
   +-- content scorer     TF-IDF over hashtags, cosine similarity
   +-- collaborative      BPR-MF, learned by SGD
   +-- popularity         time-decayed engagement (cold-start fallback)
   +-- weighted combiner  min-max normalise -> w1*c + w2*cf + w3*pop
   |
   v  ranked post IDs  ->  Next.js hydrates rows via Prisma, preserving order
```

The service returns **IDs only**. Post content is hydrated by the web app
through `getPostDataInclude`, so select shapes and permissions stay defined in
one place.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
export DATABASE_URL="postgresql://.../chitchat"   # same DB as the web app
```

## Commands

```bash
python -m app.train              # train and save models/model.npz
python -m app.train --evaluate   # train, then run the full evaluation
python -m app.evaluate           # offline evaluation -> models/metrics.json
python -m app.tune               # grid search BPR hyper-parameters
python -m app.tune --weights     # grid search the hybrid blend weights
uvicorn app.main:app --port 8001 # serve
```

Or via Docker, from the repository root:

```bash
docker compose up --build ml     # published on host port 8001
```

> Host port **8001**, not 8000 — another local project already publishes a
> container on 8000.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | up, model loaded, age of the current model |
| GET | `/recommend/{user_id}?feed=home\|explore&n=200` | ranked post IDs |
| GET | `/similar/{post_id}` | "more like this" via learned post vectors |
| GET | `/metrics` | last offline evaluation |
| POST | `/train` | retrain now |

The service retrains itself every 15 minutes (`ML_RETRAIN_INTERVAL`).

## Configuration

All tunables live in `app/config.py` and are overridable by environment
variable — see that file for the full list. The most important:

| Variable | Default | Meaning |
|---|---|---|
| `ML_N_FACTORS` | 32 | BPR latent vector width |
| `ML_W_CONTENT` / `ML_W_CF` / `ML_W_POPULARITY` | 0.50 / 0.10 / 0.40 | blend weights |
| `ML_RETRAIN_INTERVAL` | 900 | seconds between retrains |

The hyper-parameters and blend weights are **fitted by `app/tune.py`** on a
validation fold carved out of the training data, never on the test set.

## Evaluation

`app/evaluate.py` uses a **temporal** 80/20 split (oldest interactions train,
newest test) and reports precision@k, recall@k, NDCG@k, catalogue coverage and
novelty for the hybrid and four baselines: random, popularity-only,
content-only and CF-only.

Two results are worth understanding before trusting any number:

- **If popularity-only scores very highly**, the dataset is too easy, not the
  model too good. Engagement is probably clustered too tightly by topic —
  adjust the difficulty parameters in `src/lib/recommendation/scripts/seed.ts`.
- **If the hybrid loses to one of its own components**, the blend weights are
  wrong. Re-run `python -m app.tune --weights`.

## A note on local warnings

On macOS, NumPy built against Apple's Accelerate BLAS emits spurious
`divide by zero encountered in matmul` warnings. They occur on clean random data
with no model involved, the results are finite and correct, and they do not
occur in the Linux container. They are not a numerical problem with the model.
