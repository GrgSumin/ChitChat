"use client";
import Link from "next/link";
import UserAvatar from "@/components/ui/UserAvatar";
import { PostData } from "@/lib/types";
import { formatRelativeDate } from "@/lib/utils";
import { useSession } from "@/app/(main)/SessionProvider";
import PostMoreButton from "../PostMoreButton";

interface PostProps {
  post: PostData;
}

export default function Post({ post }: PostProps) {
  const { user } = useSession();

  return (
    <article className="group bg-card border-border rounded-2xl border p-5 shadow-sm">
      <div className="flex justify-between gap-3">
        <div className="flex gap-3">
          <Link href={`/users/${post.user.username}`}>
            <UserAvatar avatarUrl={post.user.avatarUrl} size={40} />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-x-2">
              <Link
                href={`/users/${post.user.username}`}
                className="text-foreground text-base font-medium hover:underline"
              >
                {post.user.displayName}
              </Link>
              <span className="text-muted-foreground text-sm">
                @{post.user.username}
              </span>
              <span className="text-muted-foreground text-sm">·</span>
              <span className="text-muted-foreground text-sm">
                {formatRelativeDate(post.createdAt)}
              </span>
            </div>
            <p className="text-foreground mt-2 text-sm break-words whitespace-pre-line">
              {post.content}
            </p>
          </div>
        </div>
        {post.user.id === user.id && (
          <PostMoreButton
            className="opacity-0 transition-opacity group-hover:opacity-100"
            post={post}
          />
        )}
      </div>
    </article>
  );
}
