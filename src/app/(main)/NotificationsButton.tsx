"use client";
import kyInstance from "@/lib/ky";
import { NotificationCountInfo } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";

export default function NotificationsButton() {
  const { data } = useQuery({
    queryKey: ["unread-notification-count"],
    queryFn: () =>
      kyInstance
        .get("/api/notification/unread-count")
        .json<NotificationCountInfo>(),
    refetchInterval: 60 * 1000,
  });
  return (
    <Link
      href="/notifications"
      className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
    >
      <div className="relative">
        <Bell className="size-5" />
        {!!data?.unreadCount && (
          <span className="bg-primary text-primary-foreground absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full text-[10px] font-medium tabular-nums">
            {data.unreadCount}
          </span>
        )}
      </div>
      Notifications
    </Link>
  );
}
