"use client";
import Link from "next/link";
import UserAvatar from "@/components/ui/UserAvatar";
import { PostData } from "@/lib/types";
import { cn, formatRelativeDate } from "@/lib/utils";
import { useSession } from "@/app/(main)/SessionProvider";
import PostMoreButton from "../PostMoreButton";
import Linkify from "@/components/Linkiyfy";
import UserTooltip from "@/components/UserTooltip";
import { Media } from "@/generated/prisma/client";
import Image from "next/image";
import LikeButton from "../LikeButton";
import BookmarkButton from "../BookMarkButton";
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import Comments from "@/components/comments/Comments";

interface PostProps {
  post: PostData;
}

export default function Post({ post }: PostProps) {
  const { user } = useSession();

  const [showComments, setShowComments] = useState<boolean>(false);

  return (
    <article className="group/post bg-card border-border relative rounded-2xl border p-5 shadow-sm">
      <Link
        href={`/posts/${post.id}`}
        className="absolute inset-0 z-0"
        aria-label="View post"
      />
      <div className="flex justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <UserTooltip user={post.user}>
            <Link
              href={`/users/${post.user.username}`}
              className="relative z-10"
            >
              <UserAvatar avatarUrl={post.user.avatarUrl} size={40} />
            </Link>
          </UserTooltip>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-x-2">
              <UserTooltip user={post.user}>
                <Link
                  href={`/users/${post.user.username}`}
                  className="text-foreground relative z-10 text-base font-medium hover:underline"
                >
                  {post.user.displayName}
                </Link>
              </UserTooltip>
              <span className="text-muted-foreground text-sm">
                @{post.user.username}
              </span>
              <span className="text-muted-foreground text-sm">·</span>
              <Link
                href={`/posts/${post.id}`}
                className="text-muted-foreground relative z-10 text-sm hover:underline"
                suppressHydrationWarning
              >
                {formatRelativeDate(post.createdAt)}
              </Link>
            </div>
            <Linkify>
              <p className="text-foreground relative z-10 mt-2 w-fit text-sm break-words whitespace-pre-line">
                {post.content}
              </p>
            </Linkify>

            {!!post.attachments.length && (
              <MediaPreviews attachment={post.attachments} />
            )}
          </div>
        </div>
        {post.user.id === user.id && (
          <PostMoreButton
            className="relative z-10 opacity-0 transition-opacity group-hover/post:opacity-100"
            post={post}
          />
        )}
      </div>
      <hr className="border-border my-3" />
      <div className="relative z-10 flex w-full items-center justify-between gap-5">
        <div className="flex items-center gap-5">
          <LikeButton
            postId={post.id}
            initialState={{
              like: post._count.likes,
              isLikedByUser: post.likes.some((like) => like.userId === user.id),
            }}
          />
          <CommentButton
            post={post}
            onClick={() => setShowComments(!showComments)}
          />
        </div>
        <BookmarkButton
          postId={post.id}
          initialState={{
            isBookMarkedByUser: post.bookmarks.some(
              (bookmark) => bookmark.userId === user.id,
            ),
          }}
        />
      </div>
      {showComments && <Comments post={post} />}
    </article>
  );
}
interface MediaPreviewsProps {
  attachment: Media[];
}

function MediaPreviews({ attachment }: MediaPreviewsProps) {
  const multiple = attachment.length > 1;

  return (
    <div
      className={cn(
        "border-border bg-muted relative z-10 mt-3 grid gap-0.5 overflow-hidden rounded-2xl border",
        multiple && "grid-cols-2",
      )}
    >
      {attachment.map((m) => (
        <MediaPreview key={m.id} media={m} multiple={multiple} />
      ))}
    </div>
  );
}

interface MediaPreviewProps {
  media: Media;
  multiple: boolean;
}

function MediaPreview({ media, multiple }: MediaPreviewProps) {
  if (media.type === "IMAGE") {
    if (multiple) {
      return (
        <div className="relative aspect-square w-full">
          <Image
            src={media.url}
            alt="attachment"
            fill
            sizes="(max-width: 640px) 50vw, 300px"
            className="object-cover"
          />
        </div>
      );
    }
    return (
      <Image
        src={media.url}
        alt="attachment"
        width={800}
        height={800}
        sizes="(max-width: 640px) 100vw, 600px"
        className="mx-auto max-h-120 w-auto object-contain"
      />
    );
  }

  if (media.type === "VIDEO") {
    if (multiple) {
      return (
        <div className="relative aspect-square w-full">
          <video
            src={media.url}
            controls
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      );
    }
    return <video src={media.url} controls className="max-h-[30rem] w-full" />;
  }

  return <p className="text-destructive">Unsupported media type</p>;
}

interface CommnetButtonProps {
  post: PostData;
  onClick: () => void;
}

function CommentButton({ post, onClick }: CommnetButtonProps) {
  return (
    <button onClick={onClick} className="flex items-center gap-2">
      <MessageSquare className="size-5" />
      <span className="text-sm font-medium tabular-nums">
        {post._count.comments}{" "}
        <span className="hidden sm:inline">comments</span>
      </span>
    </button>
  );
}
