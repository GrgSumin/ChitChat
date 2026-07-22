"use client";

import { useRouter } from "next/navigation";
import { Input } from "./input";
import { Loader2, SearchIcon } from "lucide-react";
import { useState } from "react";
import useDebounce from "@/hooks/useDebounce";
import { useQuery } from "@tanstack/react-query";
import kyInstance from "@/lib/ky";
import { ChatUser } from "@/lib/types";
import Link from "next/link";
import UserAvatar from "./UserAvatar";

export default function SearchField() {
  const router = useRouter();

  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const query = useDebounce(value.trim(), 300);

  const { data: users, isFetching } = useQuery({
    queryKey: ["search-suggestions", query],
    queryFn: () =>
      kyInstance
        .get("/api/users/search", { searchParams: { q: query } })
        .json<ChatUser[]>(),
    enabled: query.length > 0,
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); //by default it can refresh when we submit form
    const q = value.trim();
    if (!q) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="relative max-w-md flex-1">
      <form onSubmit={handleSubmit} method="GET" action="/search">
        <div className="relative">
          <Input
            name="q"
            placeholder="Search..."
            className="pe-10"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          <SearchIcon className="text-muted-foreground/80 absolute top-1/2 right-3 size-4 -translate-y-1/2" />
        </div>
      </form>

      {open && value.trim() && (
        <div className="bg-card border-border absolute top-full z-50 mt-2 w-full overflow-hidden rounded-xl border shadow-lg">
          {isFetching && (
            <div className="flex justify-center p-4">
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            </div>
          )}

          {!isFetching && users?.length === 0 && (
            <p className="text-muted-foreground p-4 text-sm">
              No people found.
            </p>
          )}

          {users?.map((u) => (
            <Link
              key={u.id}
              href={`/users/${u.username}`}
              onClick={() => setOpen(false)}
              className="hover:bg-muted flex items-center gap-3 p-3"
            >
              <UserAvatar
                avatarUrl={u.avatarUrl}
                size={36}
                className="flex-none"
              />
              <div className="min-w-0">
                <p className="text-foreground line-clamp-1 text-sm font-medium">
                  {u.displayName}
                </p>
                <p className="text-muted-foreground line-clamp-1 text-xs">
                  @{u.username}
                </p>
              </div>
            </Link>
          ))}

          {value.trim() && (
            <Link
              href={`/search?q=${encodeURIComponent(value.trim())}`}
              onClick={() => setOpen(false)}
              className="hover:bg-muted text-muted-foreground block border-t p-3 text-sm"
            >
              See all results for &quot;{value.trim()}&quot;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
