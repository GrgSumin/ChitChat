"use client";

import { useSession } from "@/app/(main)/SessionProvider";
import { FollowerInfo, UserData } from "@/lib/types";
import { PropsWithChildren } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import Link from "next/link";
import UserAvatar from "./ui/UserAvatar";
import FollowButton from "./FollowButton";
import Linkify from "./Linkiyfy";
import FollowerCount from "./FollowerCount";

interface UserTooltipProps extends PropsWithChildren {
  user: UserData;
}

export default function UserTooltip({ children, user }: UserTooltipProps) {
  const { user: loggedInUser } = useSession();

  const followerState: FollowerInfo = {
    followers: user._count.followers,
    isFollowedByUser: !!user.followers.some(
      ({ followerId }) => followerId === loggedInUser.id,
    ),
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-0">{children}</span>
        </TooltipTrigger>
        <TooltipContent className="w-64 max-w-[calc(100vw-2rem)] rounded-2xl p-4 text-sm">
          <div className="flex w-full flex-col gap-3 break-words">
            <div className="flex items-start justify-between gap-4">
              <Link href={`/users/${user.username}`}>
                <UserAvatar size={60} avatarUrl={user.avatarUrl} />
              </Link>
              {loggedInUser.id !== user.id && (
                <FollowButton userId={user.id} initialState={followerState} />
              )}
            </div>
            <div>
              <Link href={`/users/${user.username}`} className="block">
                <p className="text-base font-semibold hover:underline">
                  {user.displayName}
                </p>
                <p className="text-muted-foreground text-sm">
                  @{user.username}
                </p>
              </Link>
            </div>
            {user.bio && (
              <Linkify>
                <p className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-line">
                  {user.bio}
                </p>
              </Linkify>
            )}
            <FollowerCount userId={user.id} initialState={followerState} />
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
