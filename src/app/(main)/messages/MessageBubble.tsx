"use client";

import { MessageData } from "@/lib/types";
import { useSession } from "../SessionProvider";
import { cn } from "@/lib/utils";
import UserAvatar from "@/components/ui/UserAvatar";
import Image from "next/image";
import { format } from "date-fns";

interface MessageBubbleProps {
  message: MessageData;
  isGroup: boolean;
}
export default function MessageBubble({
  message,
  isGroup,
}: MessageBubbleProps) {
  const { user } = useSession();
  const mine = message.sender.id === user.id;

  return (
    <div
      className={cn(
        "flex w-full gap-2",
        mine ? "justify-end" : "justify-start",
      )}
    >
      {!mine && (
        <UserAvatar
          avatarUrl={message.sender.avatarUrl}
          size={28}
          className="mt-auto hidden sm:block"
        />
      )}
      <div
        className={cn(
          "max-w-[75%] space-y-1 rounded-2xl px-4 py-2 text-sm",
          mine
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {isGroup && !mine && (
          <p className="text-xs font-semibold opacity-70">
            {message.sender.displayName}
          </p>
        )}
        {message.attachments.map((media) =>
          media.type === "IMAGE" ? (
            <Image
              key={media.id}
              src={media.url}
              alt="Attachment"
              width={400}
              height={400}
              className="h-auto max-h-64 w-auto rounded-lg object-contain"
            />
          ) : (
            <video
              key={media.id}
              src={media.url}
              controls
              className="max-h-64 rounded-lg"
            />
          ),
        )}
        {message.content && (
          <p className="break-words whitespace-pre-line">{message.content}</p>
        )}
        <p
          className={cn(
            "text-[10px]",
            mine ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {format(message.createdAt, "HH:mm")}
        </p>
      </div>
    </div>
  );
}
