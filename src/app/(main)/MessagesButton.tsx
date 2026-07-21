"use client";

import kyInstance from "@/lib/ky";
import { MessagesCountInfo } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import Link from "next/link";

export default function MessageButton() {
  const { data } = useQuery({
    queryKey: ["unread-messages-count"],
    queryFn: () =>
      kyInstance.get("/api/chats/unread-count").json<MessagesCountInfo>(),
    refetchInterval: 60 * 1000,
  });
  return (
    <Link
      href="/messages"
      className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
    >
      <div className="relative">
        <Mail className="size-5" />
        {!!data?.unreadCount && (
          <span className="bg-primary text-primary-foreground absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full text-[10px] font-medium tabular-nums">
            {data.unreadCount}
          </span>
        )}
      </div>
      Messages
    </Link>
  );
}
