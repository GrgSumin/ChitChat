import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { FollowerInfo, getUserDataSelect, UserData } from "@/lib/types";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { format } from "date-fns";
import { formatNumber } from "@/lib/utils";
import UserAvatar from "@/components/ui/UserAvatar";
import FollowButton from "@/components/FollowButton";
import FollowerCount from "@/components/FollowerCount";
import { Button } from "@/components/ui/button";
import TrendingSidebar from "@/components/TrendingSIdebar";
import UserPosts from "./UserPosts";

interface PageProps {
  params: Promise<{ username: string }>;
}

const getUser = cache(async (username: string, loggedInUserId: string) => {
  const user = await prisma.user.findFirst({
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
    select: getUserDataSelect(loggedInUserId),
  });
  if (!user) notFound();
  return user;
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params;
  const { user: loggedUser } = await validateRequest();

  if (!loggedUser) return {};

  const user = await getUser(username, loggedUser.id);
  return {
    title: `${user.displayName} (@${user.username})`,
  };
}

export default async function Page({ params }: PageProps) {
  const { username } = await params;
  const { user: loggedUser } = await validateRequest();

  if (!loggedUser) {
    return (
      <p className="text-destructive">
        You&apos;re not authorized to view this page
      </p>
    );
  }
  const user = await getUser(username, loggedUser.id);

  return (
    <div className="space-y- flex w-full min-w-0 gap-5">
      <div className="w-full min-w-0 space-y-5">
        <UserProfile user={user} loggedInUserId={loggedUser.id} />
        <div className="bg-card rounded-2xl p-5 shadow-sm">
          <h2 className="text-center text-2xl font-bold">
            {user.displayName}&apos;s posts
          </h2>
        </div>
        <UserPosts userId={user.id} />
      </div>
      <TrendingSidebar />
    </div>
  );
}

interface UserProfileProps {
  user: UserData;
  loggedInUserId: string;
}

async function UserProfile({ user, loggedInUserId }: UserProfileProps) {
  const followerInfo: FollowerInfo = {
    followers: user._count.followers,
    isFollowedByUser: user.followers.some(
      ({ followerId }) => followerId === loggedInUserId,
    ),
  };

  return (
    <div className="bg-card border-border space-y-5 rounded-2xl border p-5 shadow-sm">
      <UserAvatar
        avatarUrl={user.avatarUrl}
        size={150}
        className="mx-auto size-full max-h-60 max-w-60 rounded-full"
      />
      <div className="flex flex-wrap gap-3 sm:flex-nowrap">
        <div className="me-auto space-y-3">
          <div>
            <h1 className="text-foreground text-3xl font-bold">
              {user.displayName}
            </h1>
            <div className="text-muted-foreground">@{user.username}</div>
          </div>
          <div className="text-muted-foreground text-sm">
            Joined at {format(user.createdAt, "MMM d, yyyy")}
          </div>
          <div className="flex items-center gap-3">
            <span>
              Posts:{" "}
              <span className="font-semibold">
                {formatNumber(user._count.posts)}
              </span>
            </span>
            <FollowerCount userId={user.id} initialState={followerInfo} />
          </div>
        </div>
        {user.id === loggedInUserId ? (
          <Button>Edit Profile</Button>
        ) : (
          <FollowButton userId={user.id} initialState={followerInfo} />
        )}
      </div>
      {user.bio && (
        <>
          <hr className="border-border" />
          <div className="overflow-hidden break-words whitespace-pre-line">
            {user.bio}
          </div>
        </>
      )}
    </div>
  );
}
