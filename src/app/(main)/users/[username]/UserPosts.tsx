"use client";

import InfiniteScrollContainer from "@/components/InfiniteScrollContainer";
import Post from "@/components/posts/editor/Post";
import PostsLoader from "@/components/posts/PostLoader";
import { Button } from "@/components/ui/button";
import kyInstance from "@/lib/ky";
import { PostsPage } from "@/lib/types";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";

interface UserPostsProps {
  userId: string;
}

export default function UserPosts({ userId }: UserPostsProps) {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    status,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["post-feed", "user-posts", userId],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          `/api/users/${userId}/posts`,
          pageParam ? { searchParams: { cursor: pageParam } } : {},
        )
        .json<PostsPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const posts = data?.pages.flatMap((page) => page.posts) || [];

  if (status === "pending") {
    return <PostsLoader />;
  }

  if (status === "success" && !posts.length && !hasNextPage) {
    return (
      <div className="bg-card border-border flex flex-col items-center gap-3 rounded-2xl border p-10 text-center shadow-sm">
        <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
          <Sparkles className="size-7" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-foreground text-base font-medium">
            This user hasn&apos;t posted anything yet
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            When they post something, it&apos;ll show up here.
          </p>
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="bg-card border-border flex flex-col items-center gap-3 rounded-2xl border p-10 text-center shadow-sm">
        <div className="bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-full">
          <AlertTriangle className="size-7" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-foreground text-base font-medium">
            Something went wrong
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            We couldn&apos;t load these posts. Check your connection and try
            again.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <InfiniteScrollContainer
      className="space-y-2"
      onBottomReached={() => hasNextPage && !isFetching && fetchNextPage()}
    >
      {posts.map((post) => (
        <Post key={post.id} post={post} />
      ))}
      {isFetchingNextPage && <Loader2 className="mx-auto my-4 animate-spin" />}
    </InfiniteScrollContainer>
  );
}
