import { getTrendingTopics } from "@/lib/trending";
import { formatNumber } from "@/lib/utils";
import { TrendingUp } from "lucide-react";
import Link from "next/link";

// Four rows of two. The sidebar shows five; this has the width for more.
const TOPIC_COUNT = 8;

export default async function TrendingTopicsGrid() {
  const topics = await getTrendingTopics(TOPIC_COUNT);

  // A brand-new database has no hashtags yet -- render nothing rather than an
  // empty card with a heading and no content.
  if (!topics.length) return null;

  return (
    <div className="bg-card border-border rounded-2xl border p-5 shadow-sm">
      <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
        Trending
      </h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {topics.map(({ hashtag, count }) => {
          // Stored with the leading '#', but the route segment is without it.
          const title = hashtag.split("#")[1];

          return (
            <Link
              key={hashtag}
              href={`/hashtag/${title}`}
              className="border-border hover:bg-muted flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors"
            >
              <div className="min-w-0">
                <p
                  className="text-primary line-clamp-1 font-medium break-all"
                  title={hashtag}
                >
                  {hashtag}
                </p>
                <p className="text-muted-foreground mt-0.5 text-sm">
                  {formatNumber(count)} {count === 1 ? "post" : "posts"}
                </p>
              </div>
              <TrendingUp
                className="text-muted-foreground size-4 flex-none"
                aria-hidden
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
