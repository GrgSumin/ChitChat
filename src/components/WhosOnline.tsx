"use client";

import { useSocket } from "@/components/SocketProvider";
import UserAvatar from "@/components/ui/UserAvatar";
import kyInstance from "@/lib/ky";
import { ChatData, ChatUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { reviveDates } from "./SocketProvider";

const VISIBLE = 4;

export default function WhosOnline() {
  const router = useRouter();
  const { socket, onlineUsers } = useSocket();
  const [opening, setOpening] = useState<string | null>(null);

  const { data: following } = useQuery({
    queryKey: ["following-users"],
    queryFn: () => kyInstance.get("/api/users/following").json<ChatUser[]>(),
    staleTime: 5 * 60 * 1000,
  });

  const sorted = [...(following ?? [])].sort((a, b) => {
    const aOn = onlineUsers.has(a.id);
    const bOn = onlineUsers.has(b.id);
    if (aOn !== bOn) return aOn ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const shown = sorted.slice(0, VISIBLE);
  const onlineCount = sorted.filter((u) => onlineUsers.has(u.id)).length;

  function openChat(u: ChatUser) {
    if (!socket) {
      toast("Not connected. Try again in a second.");
      return;
    }
    setOpening(u.id);

    socket.emit("chat:create", { userIds: [u.id] }, (res) => {
      setOpening(null);
      if (res.error || !res.chat) {
        toast("Error", { description: res.error ?? "Could not open chat" });
        return;
      }
      const chat = reviveDates<ChatData>(res.chat);
      router.push(`/messages?chat=${chat.id}`);
    });
  }

  if (!following?.length) return null;

  return (
    <div className="bg-card border-border space-y-4 rounded-2xl border p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-foreground flex items-center gap-2 text-lg font-bold">
          <span
            className={cn(
              "size-2 flex-none rounded-full",
              onlineCount ? "bg-green-500" : "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          Who&apos;s online
        </h2>
        <span className="text-muted-foreground text-xs">
          {onlineCount} online
        </span>
      </div>

      {shown.map((u) => {
        const isOnline = onlineUsers.has(u.id);
        return (
          <button
            key={u.id}
            type="button"
            onClick={() => openChat(u)}
            disabled={opening === u.id}
            aria-label={`Message ${u.displayName}`}
            className="hover:bg-muted -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors disabled:opacity-60"
          >
            <div className="relative flex-none">
              <UserAvatar avatarUrl={u.avatarUrl} size={40} />
              {isOnline && (
                <span
                  className="border-card absolute right-0 bottom-0 size-3 rounded-full border-2 bg-green-500"
                  aria-hidden
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-foreground line-clamp-1 font-medium break-all">
                {u.displayName}
              </p>
              <p
                className={cn(
                  "line-clamp-1 text-sm",
                  isOnline ? "text-green-600" : "text-muted-foreground",
                )}
              >
                {isOnline ? "Active now" : "Offline"}
              </p>
            </div>

            <MessageSquare
              className="text-muted-foreground size-4 flex-none"
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}
