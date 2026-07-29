import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import {
  buildRankedIds,
  hydrateInOrder,
  parseIndexCursor,
} from "@/lib/recommendation/feed";
import { getPostDataInclude, PostsPage } from "@/lib/types";
import { NextRequest } from "next/server";

/**
 * The Explore feed: pure recommendations, no blending.
 *
 * Unlike the home feed this EXCLUDES accounts the user already follows (the ML
 * service applies that filter for `feed=explore`), because explore exists for
 * discovery -- showing followed accounts here would just mirror the home feed.
 */
export async function GET(req: NextRequest) {
  try {
    const cursor = req.nextUrl.searchParams.get("cursor") || undefined;
    const pageSize = 10;
    const { user } = await validateRequest();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rankedIds = await buildRankedIds(user.id, "explore");

    if (rankedIds) {
      const start = parseIndexCursor(cursor);
      const pageIds = rankedIds.slice(start, start + pageSize);
      const posts = await hydrateInOrder(pageIds, user.id);

      const end = start + pageSize;
      const data: PostsPage = {
        posts,
        nextCursor: end < rankedIds.length ? String(end) : null,
      };
      return Response.json(data);
    }

    // Fallback when the ML service is unavailable: show recent posts from
    // accounts the user does NOT follow, which at least preserves explore's
    // purpose (discovery) even without ranking.
    const posts = await prisma.post.findMany({
      where: {
        userId: { not: user.id },
        user: { followers: { none: { followerId: user.id } } },
      },
      include: getPostDataInclude(user.id),
      orderBy: { createdAt: "desc" },
      take: pageSize + 1,
      cursor: cursor ? { id: cursor } : undefined,
    });

    const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;

    const data: PostsPage = {
      posts: posts.slice(0, pageSize),
      nextCursor,
    };

    return Response.json(data);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
