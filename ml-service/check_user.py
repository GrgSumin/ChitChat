"""Inspect one user's three component scores separately, by username.

Useful for demonstrating collaborative filtering by hand: sign up, like several
posts on one topic, force a retrain, then run this to see what BPR alone
recommends -- without the content and popularity scorers masking it.

    ./.venv/bin/python check_user.py seed_91
    ./.venv/bin/python check_user.py kevin
"""

import sys

import numpy as np
import psycopg

from app.config import DATABASE_URL
from app.data import load_snapshot
from app.hybrid import blend_weights
from app.recommender import Recommender

np.seterr(all="ignore")

if len(sys.argv) < 2:
    sys.exit("usage: python check_user.py <username>")

username = sys.argv[1]

with psycopg.connect(DATABASE_URL) as conn:
    row = conn.execute(
        'SELECT id FROM users WHERE username = %s', (username,)
    ).fetchone()

if row is None:
    sys.exit(f"no user called {username!r}")

user_id = row[0]

snapshot = load_snapshot()
rec = Recommender().fit(snapshot, verbose=False)

posts = {p.post_id: p for p in snapshot.posts}
names = snapshot.hashtags


def tags_of(post_id: str) -> str:
    post = posts.get(post_id)
    if post is None or not post.hashtag_ids:
        return "[no hashtags]"
    return ", ".join(f"#{names.get(h, '?')}" for h in post.hashtag_ids)


n = rec.n_interactions.get(user_id, 0)
w_content, w_cf, w_pop = blend_weights(n)

print()
print(f"USER {username}  ({user_id})")
print(f"  interactions : {n}")
print(f"  weights      : content {w_content:.2f} | cf {w_cf:.2f} | popularity {w_pop:.2f}")
if w_cf == 0:
    print("  NOTE: collaborative filtering is switched off below 5 interactions.")
print()

print("  posts this user engaged with:")
engaged = [x.post_id for x in snapshot.interactions if x.user_id == user_id]
for post_id in engaged[:10]:
    print(f"    - {tags_of(post_id)}")
if len(engaged) > 10:
    print(f"    ... and {len(engaged) - 10} more")
print()

scores = rec.component_scores(user_id)
already = set(engaged)

for label, vector, blurb in [
    ("CONTENT", scores["content"], "reads hashtags"),
    ("BPR", scores["collaborative"], "behaviour only -- reads no text"),
    ("POPULARITY", scores["popularity"], "not personalised"),
]:
    finite = np.where(np.isfinite(vector), vector, -np.inf)
    print(f"  {label} top 5   ({blurb})")
    shown = 0
    for idx in np.argsort(-finite):
        post_id = rec.post_ids[idx]
        if post_id in already:
            continue          # skip things they have already seen
        print(f"    {shown + 1}. {tags_of(post_id)}")
        shown += 1
        if shown == 5:
            break
    print()
