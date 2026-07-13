"use client";

import InfiniteScrollContainer from "@/components/InfiniteScrollContainer";
import PostsLoader from "@/components/posts/PostLoader";
import { Button } from "@/components/ui/button";
import kyInstance from "@/lib/ky";
import { NotificationPage } from "@/lib/types";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { AlertTriangle, Bell, Loader2 } from "lucide-react";
import Notification from "./Notification";
import { useEffect } from "react";

export default function Notifications() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    status,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          "/api/notification",
          pageParam ? { searchParams: { cursor: pageParam } } : {},
        )
        .json<NotificationPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const queryClient = useQueryClient();

  const { mutate } = useMutation({
    mutationFn: () => kyInstance.patch("/api/notification/mark-as-read"),
    onSuccess: () => {
      queryClient.setQueryData(["unread-notification-count"], {
        unreadCount: 0,
      });
    },
    onError(error) {
      console.log("failed to mark notification", error);
    },
  });
  useEffect(() => {
    mutate();
  }, [mutate]);

  const notifications = data?.pages.flatMap((page) => page.notifications) || [];

  if (status === "pending") {
    return <PostsLoader />;
  }

  if (status === "success" && !notifications.length && !hasNextPage) {
    return (
      <div className="bg-card border-border flex flex-col items-center gap-3 rounded-2xl border p-10 text-center shadow-sm">
        <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
          <Bell className="size-7" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-foreground text-base font-medium">
            No notifications yet
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
            We couldn&apos;t load your notifications. Check your connection and
            try again.
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
      {notifications.map((notifications) => (
        <Notification key={notifications.id} notification={notifications} />
      ))}
      {isFetchingNextPage && <Loader2 className="mx-auto my-4 animate-spin" />}
    </InfiniteScrollContainer>
  );
}
