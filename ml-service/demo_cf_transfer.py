"""Shows collaborative filtering transferring a post between two similar users.

The clearest demonstration of what BPR does that content-based scoring cannot:
a post user B has never seen is recommended to them *only* because a
behaviourally similar user A engaged with it. No text is read at any point.

    ./.venv/bin/python demo_cf_transfer.py virgil mane
"""

import sys

import numpy as np
import psycopg

from app.config import DATABASE_URL
from app.data import load_snapshot
from app.model_cf import BPRMatrixFactorization

np.seterr(all="ignore")

if len(sys.argv) < 3:
    sys.exit("usage: python demo_cf_transfer.py <user_a> <user_b>")

name_a, name_b = sys.argv[1], sys.argv[2]

snapshot = load_snapshot()
model = BPRMatrixFactorization().fit(snapshot.interactions, verbose=False)

posts = {p.post_id: p for p in snapshot.posts}
names = snapshot.hashtags


def tags_of(post_id: str) -> str:
    post = posts.get(post_id)
    if post is None or not post.hashtag_ids:
        return "[no hashtags]"
    return " ".join(f"#{names.get(h, '?')}" for h in post.hashtag_ids)


with psycopg.connect(DATABASE_URL) as conn:
    ids = {}
    for username in (name_a, name_b):
        row = conn.execute(
            "SELECT id FROM users WHERE username = %s", (username,)
        ).fetchone()
        if row is None:
            sys.exit(f"no user called {username!r}")
        ids[username] = row[0]

liked = {
    username: {x.post_id for x in snapshot.interactions if x.user_id == user_id}
    for username, user_id in ids.items()
}

print()
print("=" * 62)
print("  COLLABORATIVE FILTERING -- reads no text, only behaviour")
print("=" * 62)

print(f"\n1. WHAT THEY HAVE IN COMMON")
shared = liked[name_a] & liked[name_b]
print(f"   {name_a}: {len(liked[name_a])} posts    "
      f"{name_b}: {len(liked[name_b])} posts    shared: {len(shared)}")
for post_id in list(shared)[:4]:
    print(f"     both liked  {tags_of(post_id)}")

# The item-bias column is dropped so similarity is about taste, not popularity.
factors = model.P[:, :-1]
vec_a = factors[model.user_to_idx[ids[name_a]]]
vec_b = factors[model.user_to_idx[ids[name_b]]]
similarity = float(
    vec_a @ vec_b / (np.linalg.norm(vec_a) * np.linalg.norm(vec_b) + 1e-9)
)

rng = np.random.default_rng(0)
sample = rng.choice(len(factors), min(30, len(factors)), replace=False)
baseline = np.mean([
    float(vec_a @ factors[o] / (np.linalg.norm(vec_a) * np.linalg.norm(factors[o]) + 1e-9))
    for o in sample
])

print(f"\n2. WHAT BPR LEARNED ABOUT THEM")
print(f"   similarity of their learned vectors : {similarity:+.3f}")
print(f"   similarity to 30 random users       : {baseline:+.3f}  (average)")
print(f"   BPR placed them close together purely from shared behaviour.")

scores = model.score_all(ids[name_b])
ranking = [
    i for i in np.argsort(-scores) if model.idx_to_post[i] not in liked[name_b]
]
only_a = liked[name_a] - liked[name_b]

print(f"\n3. THE TRANSFER")
print(f"   Posts {name_a} liked that {name_b} has never seen,")
print(f"   and where BPR ranks them for {name_b} out of {len(ranking)}:\n")
hits = [
    (rank, model.idx_to_post[i])
    for rank, i in enumerate(ranking, start=1)
    if model.idx_to_post[i] in only_a
]
for rank, post_id in sorted(hits):
    marker = "  <-- top of the feed" if rank <= 10 else ""
    print(f"     rank {rank:>3} of {len(ranking)}   {tags_of(post_id)}{marker}")

print()
print("   Nothing here read a hashtag. These posts surfaced only because a")
print("   user with similar behaviour engaged with them.")
print()
