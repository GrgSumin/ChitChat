import prisma from "@/lib/prisma";
import { getPostDataInclude, PostData } from "@/lib/types";
import {
  fetchRecommendations,
  RecommendationFeed,
  requestRetrain,
} from "./client";

/**
 * Shared feed assembly for the ranked feeds.
 *
 * =====================  WHY THE CURSOR CHANGED  =====================
 * The other feeds paginate with a POST ID cursor, which works because they are
 * ordered by `createdAt` and Prisma can seek straight to that row. A ranked
 * feed has no such ordering in the database -- the order lives in a scored list
 * computed elsewhere. So these feeds paginate by INDEX into that cached list
 * instead.
 *
 * This is why the ranked list has to be cached rather than recomputed per page:
 * if page 2 were ranked by a freshly retrained model, "index 10" would point
 * somewhere unrelated and the user would see duplicates and gaps while
 * scrolling. `FeedCache` pins the ordering for the duration of a scroll.
 */

/** How long a cached ranking stays valid before it is rebuilt. */
const FEED_CACHE_TTL_MS = 2 * 60 * 1000;

/** How many ranked ids to request from the ML service in one go. */
const RANKED_LIST_SIZE = 300;

/** Home feed blend: out of every 5 slots, how many come from followed accounts. */
const FOLLOWED_PER_WINDOW = 3;
const WINDOW_SIZE = 5;

export interface RankedFeedPage {
  posts: PostData[];
  nextCursor: string | null;
  /** Whether ranking came from the ML service or the fallback. Useful in
   *  development and for the evaluation chapter's screenshots. */
  ranked: boolean;
}

/**
 * Interleave followed-account posts with recommendations.
 *
 * The report's UC-07 specifies a blended home feed: the accounts a user chose
 * to follow must still be the backbone of their feed, with discovery mixed in.
 * A pure recommendation feed would quietly break the follow graph's promise --
 * you follow someone and then never see them.
 */
export function blendFeed(followedIds: string[], recommendedIds: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let f = 0;
  let r = 0;

  const push = (id: string | undefined) => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    out.push(id);
    return true;
  };

  while (f < followedIds.length || r < recommendedIds.length) {
    let placed = 0;
    // Followed slots for this window.
    while (placed < FOLLOWED_PER_WINDOW && f < followedIds.length) {
      if (push(followedIds[f++])) placed++;
    }
    // Recommendation slots for this window.
    let recPlaced = 0;
    while (recPlaced < WINDOW_SIZE - FOLLOWED_PER_WINDOW && r < recommendedIds.length) {
      if (push(recommendedIds[r++])) recPlaced++;
    }
    // Neither side advanced -- everything left is a duplicate, so stop rather
    // than spin forever.
    if (placed === 0 && recPlaced === 0) break;
  }

  return out;
}

/** Read a cached ranking if it is still fresh. */
async function readCache(userId: string, feed: string): Promise<string[] | null> {
  const row = await prisma.feedCache.findUnique({
    where: { userId_feed: { userId, feed } },
  });
  if (!row) return null;
  if (Date.now() - row.generatedAt.getTime() > FEED_CACHE_TTL_MS) return null;
  return row.postIds;
}

async function writeCache(userId: string, feed: string, postIds: string[]) {
  await prisma.feedCache.upsert({
    where: { userId_feed: { userId, feed } },
    create: { userId, feed, postIds, generatedAt: new Date() },
    update: { postIds, generatedAt: new Date() },
  });
}

/** Drop this user's cached rankings so the next feed request rebuilds. */
export async function invalidateFeedCache(userId: string): Promise<void> {
  try {
    await prisma.feedCache.deleteMany({ where: { userId } });
  } catch (error) {
    console.warn("[recommendation] failed to clear feed cache", error);
  }
  requestRetrain();
}

/** Recent posts from accounts this user follows, newest first. */
async function followedPostIds(userId: string, take: number): Promise<string[]> {
  const rows = await prisma.post.findMany({
    where: { user: { followers: { some: { followerId: userId } } } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Build (or reuse) the full ordered id list for a ranked feed.
 * Returns null if the ML service is unavailable, signalling the caller to fall
 * back to reverse-chronological.
 */
export async function buildRankedIds(
  userId: string,
  feed: RecommendationFeed,
): Promise<string[] | null> {
  const cached = await readCache(userId, feed);
  if (cached && cached.length) return cached;

  const recommendations = await fetchRecommendations(userId, feed, RANKED_LIST_SIZE);
  if (!recommendations) return null;

  const ids =
    feed === "home"
      ? blendFeed(
          await followedPostIds(userId, RANKED_LIST_SIZE),
          recommendations.postIds,
        )
      : recommendations.postIds;

  if (!ids.length) return null;

  // Cache failures must not break the request -- a slow write or a race with a
  // concurrent request is not a reason to fail the user's feed.
  try {
    await writeCache(userId, feed, ids);
  } catch (error) {
    console.warn("[recommendation] failed to write feed cache", error);
  }

  return ids;
}

/**
 * Hydrate a page of ids into full posts, PRESERVING RANK ORDER.
 *
 * This ordering step is not optional. `WHERE id IN (...)` returns rows in
 * whatever order Postgres finds convenient, so hydrating without re-sorting
 * would silently discard the ranking and produce a feed that looks arbitrary
 * while all the ML machinery still appears to run.
 */
export async function hydrateInOrder(
  pageIds: string[],
  loggedInUserId: string,
): Promise<PostData[]> {
  if (!pageIds.length) return [];

  const posts = await prisma.post.findMany({
    where: { id: { in: pageIds } },
    include: getPostDataInclude(loggedInUserId),
  });

  const byId = new Map(posts.map((p) => [p.id, p]));
  // Posts deleted since the ranking was cached simply drop out.
  return pageIds.map((id) => byId.get(id)).filter((p): p is PostData => Boolean(p));
}

/** Parse the index cursor, tolerating anything malformed. */
export function parseIndexCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
