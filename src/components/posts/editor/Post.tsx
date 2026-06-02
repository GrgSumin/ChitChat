import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import UserAvatar from "@/components/ui/UserAvatar";
import { PostData } from "@/lib/types";

interface PostProps {
  post: PostData;
}

export default function Post({ post }: PostProps) {
  return (
    <article className="bg-card border-border rounded-2xl border p-5 shadow-sm">
      <div className="flex gap-3">
        <UserAvatar avatarUrl={post.user.avatarUrl} size={40} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-2">
            <Link
              href={`/users/${post.user.username}`}
              className="text-foreground text-sm font-semibold hover:underline"
            >
              {post.user.displayName}
            </Link>
            <span className="text-muted-foreground text-sm">
              @{post.user.username}
            </span>
            <span className="text-muted-foreground text-sm">·</span>
            <span className="text-muted-foreground text-sm">
              {formatDistanceToNow(post.createdAt, { addSuffix: true })}
            </span>
          </div>
          <p className="text-foreground mt-2 text-sm break-words whitespace-pre-line">
            {post.content}
          </p>
        </div>
      </div>
    </article>
  );
}
