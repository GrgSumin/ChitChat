import ky, { HTTPError, TimeoutError } from "ky";

/**
 * Client for the Python recommendation service.
 *
 * DESIGN RULE: this module NEVER throws. The feed is the most important screen
 * in the app, and it must not go down because a separate ML process is slow,
 * restarting, or still training on boot. Every failure path returns `null`, and
 * the caller falls back to a plain reverse-chronological query.
 *
 * A degraded feed is a bad feed. A broken feed is a broken product.
 */

// Port 8001 rather than the more obvious 8000: another local project already
// publishes a container on 8000, and silently talking to the wrong ML service
// is a genuinely confusing failure to debug.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";

/** Deliberately tight: users notice 2s of blocking far more than they notice
 *  slightly less relevant ranking. */
const TIMEOUT_MS = 2000;

export type RecommendationFeed = "home" | "explore";

export interface RecommendationResponse {
  userId: string;
  feed: RecommendationFeed;
  weights: Record<string, number>;
  count: number;
  coldStart: boolean;
  postIds: string[];
  scores: number[];
}

export async function fetchRecommendations(
  userId: string,
  feed: RecommendationFeed,
  n = 200,
): Promise<RecommendationResponse | null> {
  try {
    return await ky
      .get(`${ML_SERVICE_URL}/recommend/${encodeURIComponent(userId)}`, {
        searchParams: { feed, n },
        timeout: TIMEOUT_MS,
        // The service is either up or it isn't; retrying inside a request the
        // user is waiting on just multiplies the latency they feel.
        retry: 0,
      })
      .json<RecommendationResponse>();
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.warn(`[recommendation] timed out after ${TIMEOUT_MS}ms`);
    } else if (error instanceof HTTPError) {
      // 503 is expected and benign: the service is up but has not finished its
      // first training run yet.
      const status = error.response.status;
      if (status !== 503) {
        console.warn(`[recommendation] service returned ${status}`);
      }
    } else {
      console.warn("[recommendation] service unreachable", error);
    }
    return null;
  }
}

/** Ask the ML service to retrain now. Fire-and-forget; never throws. */
export function requestRetrain(): void {
  void ky
    .post(`${ML_SERVICE_URL}/train`, { timeout: TIMEOUT_MS, retry: 0 })
    .catch(() => {});
}

export async function fetchSimilarPosts(
  postId: string,
  n = 10,
): Promise<string[] | null> {
  try {
    const res = await ky
      .get(`${ML_SERVICE_URL}/similar/${encodeURIComponent(postId)}`, {
        searchParams: { n },
        timeout: TIMEOUT_MS,
        retry: 0,
      })
      .json<{ similar: { postId: string; similarity: number }[] }>();
    return res.similar.map((s) => s.postId);
  } catch {
    return null;
  }
}
