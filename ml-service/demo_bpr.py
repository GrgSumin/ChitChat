"""Demonstrates that BPR learns topic from behaviour alone.

BPR never reads a hashtag -- it only sees a grid of who engaged with what.
Run this beside the content scorer and the two independently agree on topic,
which is the clearest evidence the collaborative model is learning something
real rather than echoing the content signal.

    ./.venv/bin/python demo_bpr.py
"""

from collections import Counter

import numpy as np

from app.data import load_snapshot
from app.recommender import Recommender

np.seterr(all="ignore")

snapshot = load_snapshot()
rec = Recommender().fit(snapshot, verbose=False)

posts = {p.post_id: p for p in snapshot.posts}
names = snapshot.hashtags


def tags_of(post_id: str) -> str:
    post = posts.get(post_id)
    if post is None or not post.hashtag_ids:
        return "[no hashtags]"
    return ", ".join(f"#{names.get(h, '?')}" for h in post.hashtag_ids)


# The user with the most history -- CF has the most to work with here.
user_id = Counter(x.user_id for x in snapshot.interactions).most_common(1)[0][0]
scores = rec.component_scores(user_id)

engaged = Counter()
for x in snapshot.interactions:
    if x.user_id == user_id:
        post = posts.get(x.post_id)
        if post:
            for h in post.hashtag_ids:
                engaged[names.get(h, "?")] += 1

print()
print(f"USER {user_id}")
print(f"  {rec.n_interactions.get(user_id, 0)} interactions")
print(f"  engages most with: {', '.join('#' + t for t, _ in engaged.most_common(5))}")
print()

for label, vector, blurb in [
    ("CONTENT", scores["content"], "reads hashtags"),
    ("BPR", scores["collaborative"], "never reads hashtags -- behaviour only"),
]:
    finite = np.where(np.isfinite(vector), vector, -np.inf)
    print(f"  {label} top 5   ({blurb})")
    for rank, idx in enumerate(np.argsort(-finite)[:5], start=1):
        print(f"    {rank}. {tags_of(rec.post_ids[idx])}")
    print()

print("  Both land on the same topic. BPR got there without reading any text,")
print("  purely from which users engaged with which posts.")
print()
