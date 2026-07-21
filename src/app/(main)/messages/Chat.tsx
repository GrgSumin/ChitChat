"use client";

import { ChatData } from "@/lib/types";
import { useState } from "react";
import { cn } from "@/lib/utils";
import ChatSidebar from "./ChatSidebar";
import ChatWindow from "./ChatWindow";

export default function Chat() {
  const [selectedChat, setSelectedChat] = useState<ChatData | null>(null);

  return (
    <div className="bg-card flex h-[calc(100vh-5rem)] overflow-hidden rounded-2xl border">
      <ChatSidebar
        selectedChatId={selectedChat?.id ?? null}
        onSelect={setSelectedChat}
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
