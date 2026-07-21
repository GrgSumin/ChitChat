"use client";

import { ChatData, ChatsPage } from "@/lib/types";
import { useSession } from "../SessionProvider";
import { useSocket } from "@/components/SocketProvider";
import { useInfiniteQuery } from "@tanstack/react-query";
import kyInstance from "@/lib/ky";
import NewChatDialog from "./NewChatDialog";
import { Loader2, Users } from "lucide-react";
import InfiniteScrollContainer from "@/components/InfiniteScrollContainer";
import { cn } from "@/lib/utils";
import UserAvatar from "@/components/ui/UserAvatar";

interface ChatSidebarProps {
  selectedChatId: string | null;
  onSelect: (chat: ChatData) => void;
  className?: string;
}

export default function ChatSidebar({
  selectedChatId,
  onSelect,
  className,
}: ChatSidebarProps) {
  const { user } = useSession();
  const { onlineUsers } = useSocket();

  const { data, fetchNextPage, hasNextPage, isFetching, status } =
    useInfiniteQuery({
      queryKey: ["chats"],
      queryFn: ({ pageParam }) =>
        kyInstance
          .get(
            "/api/chats",
            pageParam ? { searchParams: { cursor: pageParam } } : {},
          )
          .json<ChatsPage>(),
      initialPageParam: null as string | null,
      getNextPageParam: (lastpage) => lastpage.nextCursor,
    });

  const chats = data?.pages.flatMap((page) => page.chats) || [];

  return (
    <div className={className}>
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-foreground font-bold">Chats</h2>
        <NewChatDialog onChatCreated={onSelect} />
      </div>
      {status === "pending" && (
        <Loader2 className="text-muted-foreground mx-auto my-6 animate-spin" />
      )}

      {status === "error" && (
        <p className="text-destructive p-4 text-sm">Failed to load chats.</p>
      )}
      {status === "success" && !chats.length && (
        <p className="text-muted-foreground p-4 text-sm">
          No chats yet. Start one with the + button.
        </p>
      )}

      <InfiniteScrollContainer
        className="flex-1 overflow-y-auto"
        onBottomReached={() => hasNextPage && !isFetching && fetchNextPage()}
      >
        {chats.map((chat) => {
          const other = chat.participants.find(
            (p) => p.userId !== user.id,
          )?.user;
          const title = chat.isGroup
            ? (chat.name ?? "Group")
            : (other?.displayName ?? "Chat");
          const isOnline =
            !chat.isGroup && !!other && onlineUsers.has(other.id);
          const lastMessage = chat.messages[0];
          const preview = lastMessage
            ? lastMessage.content ||
              ` ${lastMessage.attachments.length} attachment${lastMessage.attachments.length > 1 ? "s" : ""}`
            : "No message yet";
          return (
            <button
              key={chat.id}
              onClick={() => onSelect(chat)}
              className={cn(
                "hover:bg-muted flex w-full items-center gap-3 p-3 text-left transition-colors",
                selectedChatId === chat.id && "bg-muted",
              )}
            >
              <div className="relative flex-none">
                {chat.isGroup ? (
                  <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
                    <Users className="size-5" />
                  </div>
                ) : (
                  <UserAvatar avatarUrl={other?.avatarUrl} size={40} />
                )}
                {isOnline && (
                  <span className="border-card absolute right-0 bottom-0 size-3 rounded-full border-2 bg-green-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "truncate text-sm",
                      chat.unreadCount > 0 ? "font-bold" : "font-medium",
                    )}
                  >
                    {title}
                  </p>
                  {chat.unreadCount > 0 && (
                    <span className="bg-primary text-primary-foreground flex size-5 flex-none items-center justify-center rounded-full text-[10px] font-semibold tabular-nums">
                      {chat.unreadCount > 9 ? "9+" : chat.unreadCount}
                    </span>
                  )}
                </div>
                <p
                  className={cn(
                    "truncate text-xs",
                    chat.unreadCount > 0
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {preview}
                </p>
              </div>
            </button>
          );
        })}
      </InfiniteScrollContainer>
    </div>
  );
}
