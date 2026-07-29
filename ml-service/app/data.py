"""
data.py
-------
The data-access layer. Reads Postgres DIRECTLY with psycopg -- deliberately
NOT through Prisma. Prisma is the web application's ORM; the ranking pipeline
is a separate concern with a separate access path.

IMPORTANT SQL NOTE: Prisma created this schema with camelCase column names,
which Postgres folds to lowercase unless quoted. Every identifier below is
therefore double-quoted ("userId", not userId). Dropping a quote gives you a
confusing `column "userid" does not exist` error.

Table names come from the @@map directives in prisma/schema.prisma:
  users, post (SINGULAR), likes, bookmarks, comments,
  hashtags, post_hashtags, user_interests, follows, feed_cache
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import psycopg

from app.config import DATABASE_URL


@dataclass
class Interaction:
    """One engagement event, normalised across the three signal types."""

    user_id: str
    post_id: str
    kind: str  # "like" | "bookmark" | "comment"
    created_at: datetime


@dataclass
class PostMeta:
    post_id: str
    author_id: str
    created_at: datetime
    hashtag_ids: list[str]


def _connect():
    return psycopg.connect(DATABASE_URL)


# --------------------------------------------------------------------------
#  INTERACTIONS  (the training signal)
# --------------------------------------------------------------------------
def load_interactions() -> list[Interaction]:
    """
    All likes, bookmarks and comments as a single normalised event stream.

    A user may both like AND bookmark the same post -- we keep both rows.
    The weighting in model_cf.py then treats that pair as stronger evidence
    than a lone like, which is exactly what we want.

    Comments are aggregated to one row per (user, post): commenting five times
    on a thread is one interest signal, not five.
    """
    sql = """
        SELECT "userId", "postId", 'like' AS kind, "createdAt"
        FROM likes
        UNION ALL
        SELECT "userId", "postId", 'bookmark' AS kind, "createdAt"
        FROM bookmarks
        UNION ALL
        SELECT "userId", "postId", 'comment' AS kind, MIN("createdAt") AS "createdAt"
        FROM comments
        GROUP BY "userId", "postId"
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(sql)
        return [
            Interaction(user_id=r[0], post_id=r[1], kind=r[2], created_at=r[3])
            for r in cur.fetchall()
        ]


# --------------------------------------------------------------------------
#  CONTENT FEATURES
# --------------------------------------------------------------------------
def load_posts() -> list[PostMeta]:
    """Every post with its author, timestamp and hashtag ids."""
    sql = """
        SELECT p.id,
               p."userId",
               p."createdAt",
               COALESCE(
                   ARRAY_AGG(ph."hashtagId") FILTER (WHERE ph."hashtagId" IS NOT NULL),
                   '{}'
               ) AS hashtag_ids
        FROM post p
        LEFT JOIN post_hashtags ph ON ph."postId" = p.id
        GROUP BY p.id, p."userId", p."createdAt"
    """
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(sql)
        return [
            PostMeta(
                post_id=r[0], author_id=r[1], created_at=r[2], hashtag_ids=list(r[3])
            )
            for r in cur.fetchall()
        ]


def load_hashtags() -> dict[str, str]:
    """{hashtag_id: tag} -- used for explaining recommendations."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT id, tag FROM hashtags')
        return {r[0]: r[1] for r in cur.fetchall()}


def load_user_interests() -> dict[str, dict[str, float]]:
    """
    Explicitly declared interests: {user_id: {hashtag_id: score}}.

    These come from onboarding rather than behaviour, which is what makes them
    valuable -- they are the ONLY signal available for a user who has not yet
    engaged with anything (the cold-start case).
    """
    out: dict[str, dict[str, float]] = {}
    with _connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "userId", "hashtagId", score FROM user_interests')
        for user_id, hashtag_id, score in cur.fetchall():
            out.setdefault(user_id, {})[hashtag_id] = float(score)
    return out


# --------------------------------------------------------------------------
#  SOCIAL GRAPH  (used for filtering, not for scoring)
# --------------------------------------------------------------------------
def load_follows() -> dict[str, set[str]]:
    """{follower_id: {followed_id, ...}} -- lets the explore feed exclude
    accounts the user already follows."""
    out: dict[str, set[str]] = {}
    with _connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "followerId", "followingId" FROM follows')
        for follower, following in cur.fetchall():
            out.setdefault(follower, set()).add(following)
    return out


def load_user_ids() -> list[str]:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM users")
        return [r[0] for r in cur.fetchall()]


# --------------------------------------------------------------------------
#  SNAPSHOT  (one round-trip set, so training sees a consistent view)
# --------------------------------------------------------------------------
@dataclass
class Snapshot:
    interactions: list[Interaction]
    posts: list[PostMeta]
    hashtags: dict[str, str]
    user_interests: dict[str, dict[str, float]]
    follows: dict[str, set[str]]
    user_ids: list[str]

    def summary(self) -> str:
        kinds: dict[str, int] = {}
        for i in self.interactions:
            kinds[i.kind] = kinds.get(i.kind, 0) + 1
        parts = ", ".join(f"{v} {k}s" for k, v in sorted(kinds.items()))
        return (
            f"{len(self.user_ids)} users, {len(self.posts)} posts, "
            f"{len(self.interactions)} interactions ({parts}), "
            f"{len(self.hashtags)} hashtags"
        )


def load_snapshot() -> Snapshot:
    return Snapshot(
        interactions=load_interactions(),
        posts=load_posts(),
        hashtags=load_hashtags(),
        user_interests=load_user_interests(),
        follows=load_follows(),
        user_ids=load_user_ids(),
    )
