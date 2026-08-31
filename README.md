# ChitChat

A social media web application with a content-based recommendation engine.

Users post text and media, follow each other, like, comment, bookmark, search by
hashtag, and message in real time. The feed is not reverse-chronological — posts are
ranked per user by a hybrid recommender that runs as a separate Python service.

---

## How it works

Three processes talk to one PostgreSQL database.

```
                    ┌──────────┐
                    │ Browser  │
                    └────┬─────┘
                 HTTP + WebSocket
                         │
            ┌────────────▼─────────────┐
            │  Node  (server.ts)       │
            │   ├── Next.js 16         │
            │   └── Socket.IO          │
            └────┬────────────────┬────┘
                 │                │ HTTP :8001
        ┌────────▼─────┐   ┌──────▼──────────────┐
        │  PostgreSQL  │◄──┤ Python / FastAPI    │
        │    :5433     │   │ recommendation svc  │
        └──────────────┘   └─────────────────────┘
```

**Node** runs Next.js and Socket.IO on the same HTTP server — which is why there is a
custom `server.ts` rather than `next dev`. Without it there are no websockets, so no
messaging, presence or typing indicators.

**The Python service** reads the same database directly with psycopg (not Prisma — the
generated client is JavaScript). It ranks posts and returns **post IDs only**; the
Next.js side hydrates the rows through its own Prisma select shapes, so the two
services can never disagree about what a post looks like.

If the recommender is unreachable the feed falls back to reverse-chronological. The
client that calls it never throws — a degraded feed is acceptable, a broken one is not.

### The recommender

A weighted hybrid of three scorers, each normalised to 0–1 and blended:

| Scorer | Method | Weight |
|---|---|---|
| Content | TF-IDF over hashtags, cosine similarity | 0.40 |
| Collaborative | BPR matrix factorisation (`implicit`) | 0.20 |
| Popularity | Time-decayed engagement, 3-day half-life | 0.40 |

The weights shift per user: collaborative filtering is weighted to zero for someone
with no history and ramps in as they engage, so a new user still gets a sensible feed.
The service retrains in the background and swaps the model in atomically.

See `ml-service/README.md` for the model, tuning and evaluation in detail.

---

## Running it

### Prerequisites

- Node.js 20+ and **Yarn**
- Python 3.11+
- PostgreSQL 14+

### 1. Install

```bash
yarn install
```

### 2. Environment

Create `.env` in the project root:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5433/chitchat"

# OAuth — from Google Cloud Console → Credentials
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
NEXT_PUBLIC_BASE_URL="http://localhost:3000"

# File uploads — from uploadthing.com
UPLOADTHING_TOKEN="..."

# Recommendation service
ML_SERVICE_URL="http://localhost:8001"
```

The Google OAuth redirect URI must be registered as
`http://localhost:3000/api/auth/callback/google`.

### 3. Database

```bash
yarn prisma generate     # generate the client
yarn prisma db push      # create the tables
yarn seed                # optional: synthetic users, posts and engagement
```

This project prototypes with `db push` rather than migration files.

**`yarn seed` is what makes the recommender demonstrable** — it generates ~100 users
with realistic engagement so the model has something to learn from. Its parameters are
deliberately calibrated: see the header comment in
`src/lib/recommendation/scripts/seed.ts`.

### 4. Start the app

```bash
yarn dev
```

Open <http://localhost:3000>.

> **Use `yarn dev`, not `next dev`.** The custom server is what attaches Socket.IO;
> running Next directly gives you no chat, presence or typing indicators.

### 5. Start the recommendation service

In a second terminal:

```bash
cd ml-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.evaluate      # optional: train and print the results table
uvicorn app.main:app --port 8001
```

Or with Docker: `docker compose up ml`

Port **8001**, not 8000 — 8000 is commonly taken, and silently talking to the wrong
service is a confusing failure to debug.

The app works without this running; the feed just falls back to newest-first.

---

## Commands

| Command | What it does |
|---|---|
| `yarn dev` | Start the dev server (Next + Socket.IO) |
| `yarn build` | Production build |
| `yarn start` | Start the production server |
| `yarn lint` | ESLint |
| `yarn seed` | Generate the synthetic dataset |
| `yarn backfill:hashtags` | Populate hashtag tables for existing posts |
| `yarn prisma studio` | Browse the database |

In `ml-service/`:

| Command | What it does |
|---|---|
| `python -m app.train` | Train and save the model |
| `python -m app.evaluate` | Accuracy and ranking metrics vs four baselines |
| `python -m app.evaluate --full` | Adds NDCG, coverage and novelty at every k |
| `python -m app.tune` | Grid-search the model hyper-parameters |
| `python -m app.tune --weights` | Sweep the hybrid blend weights |

---

## Features

- Email/password and Google OAuth sign-in (Lucia, database-backed sessions)
- Posts with a rich-text editor and image/video attachments
- Ranked Home feed and a recommendation-driven Explore page
- Follow, like, comment, bookmark
- Notifications with unread counts
- User and hashtag search with live typeahead, plus per-hashtag pages
- Real-time direct and group messaging: presence, typing indicators, unread counts
- Light and dark themes

## Tech stack

Next.js 16 (App Router) · TypeScript · PostgreSQL · Prisma 7 · Lucia v3 + Arctic ·
Socket.IO · TanStack Query v5 · Tailwind CSS v4 · shadcn/ui · Tiptap · UploadThing ·
Python · FastAPI · NumPy · `implicit`

---

## Known limitations

- The recommender reads hashtags rather than post text, so `#js` and `#javascript` are
  treated as unrelated
- Evaluated on synthetic data, which establishes the relative ranking of the methods but
  not real user satisfaction
- Retraining is a full rebuild; incremental updates would be needed at larger scale
- No automated test suite — TypeScript and ESLint serve as static analysis
- Not deployed; development environment only
