import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import UserAvatar from "./ui/UserAvatar";
import { getTrendingTopics } from "@/lib/trending";
import { formatNumber } from "@/lib/utils";
import FollowButton from "./FollowButton";
import { getUserDataSelect } from "@/lib/types";
import UserTooltip from "./UserTooltip";
import WhosOnline from "./WhosOnline";

export default function TrendingSidebar() {
  return (
    <aside className="sticky top-20 hidden h-fit w-72 flex-none space-y-5 xl:block xl:w-80">
      <WhosOnline />
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
          <UserTooltip user={u}>
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
          </UserTooltip>
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
//#[[:almnum]_]+ regular exparession for searching hashtag(#)
async function TrendingTopics() {
  const trendingTopics = await getTrendingTopics(5);
  return (
    <div className="bg-card border-border space-y-5 rounded-2xl border p-5 shadow-sm">
      <h2 className="text-foreground text-lg font-bold">Trending topics</h2>
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
