"use client";
import { reviveDates, useSocket } from "@/components/SocketProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import UserAvatar from "@/components/ui/UserAvatar";
import useDebounce from "@/hooks/useDebounce";
import kyInstance from "@/lib/ky";
import { ChatData, ChatUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface NewChatDialogProps {
  onChatCreated: (chat: ChatData) => void;
}

export default function NewChatDialog({ onChatCreated }: NewChatDialogProps) {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [selected, setSelected] = useState<ChatUser[]>([]);
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  const searchQuery = useDebounce(searchInput);

  const { data: results, isFetching } = useQuery({
    queryKey: ["user-search", searchQuery],
    queryFn: () =>
      kyInstance
        .get("/api/users/search", { searchParams: { q: searchQuery } })
        .json<ChatUser[]>(),
    enabled: !!searchQuery.trim(),
  });
  function toggleUser(user: ChatUser) {
    setSelected((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user],
    );
  }
  function resetState() {
    setSearchInput("");
    setSelected([]);
    setGroupName("");
    setCreating(false);
  }
  function handleCreate() {
    if (!socket) {
      toast("Not connected. Try again in a second.");
      return;
    }
    if (!selected.length) return;
    if (selected.length > 1 && !groupName.trim()) {
      toast("Please give the group a name");
      return;
    }
    setCreating(true);
    socket.emit(
      "chat:create",
      {
        userIds: selected.map((u) => u.id),
        name: selected.length > 1 ? groupName.trim() : undefined,
      },
      (res) => {
        setCreating(false);
        if (res.error || !res.chat) {
          toast("Error", { description: res.error ?? "Failed to create chat" });
          return;
        }
        const chat = reviveDates<ChatData>(res.chat);
        queryClient.invalidateQueries({ queryKey: ["chats"] });
        setOpen(false);
        resetState();
        onChatCreated(chat);
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen);
        if (!newOpen) resetState();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="New Chat">
          <Plus className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>
            Search for people. Pick one for a direct chat, or several for a
            group.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search users..."
          autoFocus
        />

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selected.map((user) => (
              <button
                key={user.id}
                onClick={() => toggleUser(user)}
                className="bg-muted flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium"
              >
                {user.displayName}
                <X className="size-3" />
              </button>
            ))}
          </div>
        )}

        <div className="max-h-56 space-y-1 overflow-y-auto">
          {isFetching && (
            <Loader2 className="text-muted-foreground mx-auto my-3 animate-spin" />
          )}

          {!isFetching && searchQuery.trim() && !results?.length && (
            <p className="text-muted-foreground py-3 text-center text-sm">
              No users found
            </p>
          )}

          {results?.map((user) => {
            const isSelected = selected.some((u) => u.id === user.id);
            return (
              <button
                key={user.id}
                onClick={() => toggleUser(user)}
                className={cn(
                  "hover:bg-muted flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors",
                  isSelected && "bg-muted",
                )}
              >
                <UserAvatar avatarUrl={user.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {user.displayName}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    @{user.username}
                  </p>
                </div>
                {isSelected && <Check className="text-primary size-4" />}
              </button>
            );
          })}
        </div>
        {selected.length > 1 && (
          <Input
            placeholder="Group Name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        )}
        <Button
          onClick={handleCreate}
          disabled={!selected.length && creating}
          className="w-full"
        >
          {creating && <Loader2 className="mr-2 size-5 animate-spin" />}
          {selected.length > 1 ? "Create group Char" : "Start Chat"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
