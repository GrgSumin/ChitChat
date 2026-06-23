import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import UserAvatar from "./ui/UserAvatar";
import { unstable_cache } from "next/cache";
import { formatNumber } from "@/lib/utils";
import FollowButton from "./FollowButton";
import { getUserDataSelect } from "@/lib/types";

export default function TrendingSidebar() {
  return (
    <aside className="sticky top-20 hidden h-fit w-72 flex-none space-y-5 md:block lg:w-80">
      <Suspense fallback={<Loader2 className="mx-auto size-5 animate-spin" />}>
        <PeopleToFollow />
        <TrendingTopics />
      </Suspense>
    </aside>
  );
}

async function PeopleToFollow() {
  const { user } = await validateRequest();
  if (!user) return null;
  const userToFollow = await prisma.user.findMany({
    where: {
      NOT: { id: user.id },
      followers: {
        none: {
          followerId: user.id,
        },
      },
    },
    select: getUserDataSelect(user.id),
    take: 5,
  });
  return (
    <div className="bg-card border-border space-y-5 rounded-2xl border p-5 shadow-sm">
      <h2 className="text-foreground text-lg font-bold">People to follow</h2>
      {userToFollow.map((u) => (
        <div key={u.id} className="flex items-center justify-between gap-3">
          <Link
            href={`/users/${u.username}`}
            className="flex min-w-0 items-center gap-3"
          >
            <UserAvatar avatarUrl={u.avatarUrl} className="flex-none" />
            <div className="min-w-0">
              <p className="text-foreground line-clamp-1 text-base font-medium break-all hover:underline">
                {u.displayName}
              </p>
              <p className="text-muted-foreground line-clamp-1 text-sm break-all">
                @{u.username}
              </p>
            </div>
          </Link>
          <FollowButton
            userId={u.id}
            initialState={{
              followers: u._count.followers,
              isFollowedByUser: u.followers.some(
                ({ followerId }) => followerId === u.id,
              ),
            }}
          />
        </div>
      ))}
    </div>
  );
}
//unstable_cache is actually cached in our server(next js feature) this allows is to actually cach an oepration between multiple req and user
const getTrendingTopics = unstable_cache(
  async () => {
    const result = await prisma.$queryRaw<{ hashtag: string; count: bigint }[]>`
    SELECT LOWER(unnest(regexp_matches(content, '#[[:alnum:]_]+','g'))) AS hashtag, COUNT(*) AS count
    FROM post
    GROUP BY (hashtag)
    ORDER BY count DESC, hashtag ASC
    LIMIT 5
    `;
    return result.map((row) => ({
      hashtag: row.hashtag,
      count: Number(row.count),
    }));
  },
  ["trending_topics"],
  {
    revalidate: 3 * 60 * 60,
  },
);
//#[[:almnum]_]+ regular exparession for searching hashtag(#)
async function TrendingTopics() {
  const trendingTopics = await getTrendingTopics();
  return (
    <div className="bg-card border-border space-y-5 rounded-2xl border p-5 shadow-sm">
      <h2 className="text-foreground text-lg font-bold">TrendingTopics</h2>
      {trendingTopics.map(({ hashtag, count }) => {
        const title = hashtag.split("#")[1];

        return (
          <Link key={title} href={`/hashtag/${title}`} className="block">
            <p
              className="line-clamp-1 font-semibold break-all hover:underline"
              title={hashtag}
            >
              {hashtag}
            </p>
            <p className="text-muted-foreground text-sm">
              {formatNumber(count)} {count === 1 ? "post" : "posts"}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
