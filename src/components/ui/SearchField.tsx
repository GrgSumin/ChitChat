"use client";

import { useRouter } from "next/navigation";
import { Input } from "./input";
import { SearchIcon } from "lucide-react";

export default function SearchField() {
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); //by default it can refresh when we submit form
    const form = e.currentTarget;
    const q = (form.q as HTMLInputElement).value.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-md flex-1"
      method="GET"
      action={"/search"}
    >
      <div className="relative">
        <Input name="q" placeholder="Search..." className="pe-10" />
        <SearchIcon className="text-muted-foreground/80 absolute top-1/2 right-3 size-4 -translate-y-1/2 transform" />
      </div>
    </form>
  );
}
