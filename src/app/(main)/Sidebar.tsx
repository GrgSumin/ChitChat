"use client";

import { cn } from "@/lib/utils";
import {
  Bell,
  Bookmark,
  Compass,
  Home,
  LucideIcon,
  MessageCircle,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
];

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-muted text-foreground font-semibold"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Sidebar() {
  return (
    <aside className="bg-card sticky top-0 hidden h-screen w-64 flex-col border-r p-4 md:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-3">
        <div className="bg-primary flex h-8 w-8 items-center justify-center rounded-lg">
          <MessageCircle
            size={16}
            strokeWidth={2.5}
            className="text-primary-foreground"
          />
        </div>
        <span className="text-foreground text-lg font-bold tracking-tight">
          ChitChat
        </span>
      </Link>

      <NavLinks />
    </aside>
  );
}
