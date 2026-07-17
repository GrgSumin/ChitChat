"use client";
import { useSession } from "@/app/(main)/SessionProvider";
import {
  ClientToServerEvents,
  MessagesPage,
  ServerToClientEvents,
} from "@/lib/types";
import { InfiniteData, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SocketContextValue {
  socket: ChatSocket | null;
  onlineUsers: Set<string>;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  onlineUsers: new Set(),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reviveDates<T>(value: any): T {
  if (Array.isArray(value)) {
    return value.map((item) => reviveDates(item)) as T;
  }
  if (value && typeof value === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] =
        key.endsWith("At") && typeof val === "string"
          ? new Date(val)
          : reviveDates(val);
    }
    return result as T;
  }
  return value as T;
}

export default function SocketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [socket, setSocket] = useState<ChatSocket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const { user } = useSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    const s: ChatSocket = io();

    s.on("connect", () => {
      setSocket(s);
    });
    s.on("presence:state", (onlineUserIds) => {
      setOnlineUsers(new Set(onlineUserIds));
    });
    s.on("presence:online", ({ userId }) => {
      setOnlineUsers((prev) => new Set(prev).add(userId));
    });
    s.on("presence:offline", ({ userId }) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    });
    s.on("message:new", (rawMessage) => {
      const message = reviveDates<typeof rawMessage>(rawMessage);
      queryClient.setQueryData<InfiniteData<MessagesPage, string | null>>(
        ["messages", message.chatId],
        (oldData) => {
          const firstPage = oldData?.pages[0];
          if (!firstPage) return oldData;
          return {
            pageParams: oldData.pageParams,
            pages: [
              { ...firstPage, messages: [...firstPage.messages, message] },
              ...oldData.pages.slice(1),
            ],
          };
        },
      );
      queryClient.invalidateQueries({ queryKey: ["chats"] });
      if (message.sender.id !== user.id) {
        queryClient.invalidateQueries({ queryKey: ["unread-messages-count"] });
      }
    });
    s.on("chat:new", () => {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    });

    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [queryClient, user.id]);
  return (
    <SocketContext.Provider value={{ socket, onlineUsers }}>
      {children}
    </SocketContext.Provider>
  );
}
export function useSocket() {
  return useContext(SocketContext);
}
