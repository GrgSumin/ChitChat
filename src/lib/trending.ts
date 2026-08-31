import { unstable_cache } from "next/cache";
import prisma from "./prisma";

export interface TrendingTopic {
  /** Includes the leading '#'. Strip it before building a /hashtag/ href. */
  hashtag: string;
  count: number;
}

export function getTrendingTopics(limit: number): Promise<TrendingTopic[]> {
  return unstable_cache(
    async () => {
      const result = await prisma.$queryRaw<
        { hashtag: string; count: bigint }[]
      >`
        SELECT LOWER(unnest(regexp_matches(content, '#[[:alnum:]_]+','g'))) AS hashtag,
               COUNT(*) AS count
        FROM post
        GROUP BY (hashtag)
        ORDER BY count DESC, hashtag ASC
        LIMIT ${limit}
      `;
      // COUNT() comes back as bigint, which JSON.stringify refuses to serialise.
      return result.map((row) => ({
        hashtag: row.hashtag,
        count: Number(row.count),
      }));
    },
    ["trending_topics", String(limit)],
    { revalidate: 3 * 60 * 60 },
  )();
}
