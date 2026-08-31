"use client";

import { ChatData } from "@/lib/types";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import ChatSidebar from "./ChatSidebar";
import ChatWindow from "./ChatWindow";

export default function Chat() {
  const [selectedChat, setSelectedChat] = useState<ChatData | null>(null);

  // /messages?chat=<id> lets other screens (the "Who's online" card) drop the
  // user straight into a conversation. The selection lives in React state, so
  // the sidebar -- which already holds the chat list -- resolves the id to a
  // ChatData and calls onSelect once.
  const chatIdFromUrl = useSearchParams().get("chat");

  return (
    <div className="bg-card flex h-[calc(100vh-5rem)] overflow-hidden rounded-2xl border">
      <ChatSidebar
        selectedChatId={selectedChat?.id ?? null}
        onSelect={setSelectedChat}
        autoSelectChatId={chatIdFromUrl}
        className={cn(
          "w-full flex-col border-r lg:flex lg:w-80 lg:flex-none",
          selectedChat ? "hidden lg:flex" : "flex",
        )}
      />
      {selectedChat ? (
        <ChatWindow
          key={selectedChat.id}
          chat={selectedChat}
          onBack={() => setSelectedChat(null)}
        />
      ) : (
        <div className="text-muted-foreground hidden flex-1 items-center justify-center lg:flex">
          Select a chat to start messaging
        </div>
      )}
    </div>
  );
}
