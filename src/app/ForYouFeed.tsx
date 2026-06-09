"use client";

import Post from "@/components/posts/editor/Post";
import { Button } from "@/components/ui/button";
import kyInstance from "@/lib/ky";
import { PostData, PostsPage } from "@/lib/types";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

export default function ForYouFeed() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } =
    useInfiniteQuery({
      queryKey: ["post-feed", "for-you"],
      queryFn: ({ pageParam }) =>
        kyInstance
          .get(
            "/api/posts/for-you",
            pageParam ? { searchParams: { cursor: pageParam } } : {},
          )
          .json<PostsPage>(),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    });

  const posts = data?.pages.flatMap((page) => page.posts) || [];

  if (status === "pending") {
    return <Loader2 className="mx-auto animate-spin" />;
  }
  if (status === "error") {
    return (
      <p className="text-destructive text-center">
        An error has occures while loading the post
      </p>
    );
  }
  return (
    <>
      {posts.map((post) => (
        <Post key={post.id} post={post} />
      ))}
      <Button onClick={() => fetchNextPage()}>Load More</Button>
    </>
  );
}
