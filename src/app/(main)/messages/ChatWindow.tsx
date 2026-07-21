"use client";

import { ChatData, ChatsPage, MessagesPage, TypingInfo } from "@/lib/types";
import { useSession } from "../SessionProvider";
import { useSocket } from "@/components/SocketProvider";
import {
  InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import kyInstance from "@/lib/ky";
import { useEffect, useRef, useState } from "react";
import UseMediaUpload from "@/components/posts/editor/useMediaUpload";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  Loader2,
  Paperclip,
  SendHorizontal,
  Users,
  X,
} from "lucide-react";
import UserAvatar from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";
import MessageBubble from "./MessageBubble";
import TypingBubble from "./TypingBubble";
import { Input } from "@/components/ui/input";

interface ChatWindowProps {
  chat: ChatData;
  onBack: () => void;
}

export default function ChatWindow({ chat, onBack }: ChatWindowProps) {
  const { user } = useSession();
  const { socket, onlineUsers } = useSocket();
  const queryClient = useQueryClient();

  const other = chat.participants.find((p) => p.userId !== user.id)?.user;

  const title = chat.isGroup
    ? (chat.name ?? "group")
    : (other?.displayName ?? "Chat");
  const isOnline = !chat.isGroup && !!other && onlineUsers.has(other.id);

  const { data, fetchNextPage, hasNextPage, isFetching, status } =
    useInfiniteQuery({
      queryKey: ["messages", chat.id],
      queryFn: ({ pageParam }) =>
        kyInstance
          .get(
            `/api/chats/${chat.id}/messages`,
            pageParam ? { searchParams: { cursor: pageParam } } : {},
          )
          .json<MessagesPage>(),
      initialPageParam: null as string | null,
      getNextPageParam: (firstPage) => firstPage.previousCursor,
      select: (data) => ({
        pages: [...data.pages].reverse(),
        pageParams: [...data.pageParams].reverse(),
      }),
    });
  const messages = data?.pages.flatMap((page) => page.messages) || [];

  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(
    new Map(),
  );

  useEffect(() => {
    if (!socket) return;

    const handleTyping = (info: TypingInfo) => {
      if (info.chatId !== chat.id || info.userId === user.id) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        if (info.isTyping) next.set(info.userId, info.displayName);
        else next.delete(info.userId);
        return next;
      });
    };
    socket.on("typing", handleTyping);
    return () => {
      socket.off("typing", handleTyping);
    };
  }, [socket, chat.id, user.id]);

  useEffect(() => {
    if (!socket) return;
    socket.emit("chat:read", { chatId: chat.id });

    queryClient.setQueryData<InfiniteData<ChatsPage, string | null>>(
      ["chats"],
      (oldData) => {
        if (!oldData) return oldData;
        return {
          pageParams: oldData.pageParams,
          pages: oldData.pages.map((page) => ({
            ...page,
            chats: page.chats.map((c) =>
              c.id === chat.id ? { ...c, unreadCount: 0 } : c,
            ),
          })),
        };
      },
    );
    queryClient.invalidateQueries({ queryKey: ["unread-messages-count"] });
  }, [socket, chat.id, messages.length, queryClient]);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typingUsers.size]);

  const [input, setInput] = useState("");
  const typingTimeOutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    startUpload,
    attachments,
    isUploading,
    removeAttachment,
    reset: resetUploads,
  } = UseMediaUpload();

  function handleInputChange(value: string) {
    setInput(value);
    if (!socket) return;
    if (!isTypingRef.current) {
      socket.emit("typing:start", { chatId: chat.id });
      isTypingRef.current = true;
    }
    if (typingTimeOutRef.current) clearTimeout(typingTimeOutRef.current);
    typingTimeOutRef.current = setTimeout(() => stopTyping(), 2000);
  }

  function stopTyping() {
    if (typingTimeOutRef.current) clearTimeout(typingTimeOutRef.current);
    if (isTypingRef.current && socket) {
      socket.emit("typing:stop", { chatId: chat.id });
    }
  }
  function handleSend() {
    const content = input.trim();
    const attachmentIds = attachments
      .map((a) => a.mediaId)
      .filter(Boolean) as string[];

    if (!content && !attachmentIds.length) return;
    if (isUploading) {
      toast("Please wait for uploads to finish");
      return;
    }
    if (!socket) {
      toast("Not connected. Try again in a second.");
      return;
    }
    socket.emit(
      "message:send",
      { chatId: chat.id, content, attachmentIds },
      (res) => {
        if (res.error) toast("Error", { description: res.error });
      },
    );
    setInput("");
    resetUploads();
    stopTyping();
  }

  const typingNames = [...typingUsers.values()];
  const statusLine =
    typingNames.length > 0
      ? `${typingNames.join(", ")} ${typingNames.length > 1 ? "are" : "is"} typing`
      : chat.isGroup
        ? `${chat.participants.length} members`
        : isOnline
          ? "Online"
          : "Offline";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b p-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onBack}
          aria-label="Back to chat list"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <div className="relative flex-none">
          {chat.isGroup ? (
            <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-full">
              <Users className="size-4" />
            </div>
          ) : (
            <UserAvatar avatarUrl={other?.avatarUrl} size={36} />
          )}
          {isOnline && (
            <span className="border-card absolute right-0 bottom-0 size-2.5 rounded-full border-2 bg-green-500" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p
            className={cn(
              "truncate text-xs",
              typingNames.length > 0
                ? "text-primary"
                : isOnline
                  ? "text-green-500"
                  : "text-muted-foreground",
            )}
          >
            {statusLine}
          </p>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {status === "pending" && (
          <Loader2 className="text-muted-foreground mx-auto animate-spin" />
        )}
        {status === "error" && (
          <p className="text-destructive text-center text-sm">
            Failed to load messages.
          </p>
        )}
        {hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={isFetching}
              onClick={() => fetchNextPage()}
            >
              Load older messages
            </Button>
          </div>
        )}
        {status === "success" && !messages.length && (
          <p className="text-muted-foreground text-center text-sm">
            No messages yet. Say hi 👋
          </p>
        )}
        {messages.map((messages) => (
          <MessageBubble
            key={messages.id}
            message={messages}
            isGroup={chat.isGroup}
          />
        ))}
        {typingUsers.size > 0 && <TypingBubble />}
        <div className="" ref={bottomRef} />
      </div>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t px-3 pt-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.file.name}
              className="bg-muted flex items-center gap-2 rounded-full px-3 py-1 text-xs"
            >
              {attachment.isUploading && (
                <Loader2 className="size-3 animate-spin" />
              )}
              <span className="max-w-32 truncate">{attachment.file.name}</span>
              {!attachment.isUploading && (
                <button
                  onClick={() => removeAttachment(attachment.file.name)}
                  aria-label="Remove attachment"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 p-3">
        <input
          type="file"
          ref={fileInputRef}
          className="sr-only"
          multiple
          accept="image/* , video/*"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) startUpload(files);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="flex-none"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach photo or video"
        >
          <Paperclip className="size-5" />
        </Button>
        <Input
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={`Message ${title}`}
          className="min-w-0"
        />
        <Button
          size="icon"
          className="flex-none"
          onClick={handleSend}
          disabled={(!input.trim() && !attachments.length) || isUploading}
          aria-label="Send message"
        >
          <SendHorizontal className="size-5" />
        </Button>
      </div>
    </div>
  );
}
