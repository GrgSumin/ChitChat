import { validateRequest } from "@/auth";
import { redirect } from "next/navigation";
import SessionProvider from "./SessionProvider";
import Sidebar from "./Sidebar";
import MobileSidebar from "./MobileSidebar";
import SearchField from "@/components/ui/SearchField";
import ThemeToggle from "@/components/ui/ThemeToggle";
import UserButton from "@/components/ui/UserButton";
import Link from "next/link";
import { MessageCircle } from "lucide-react";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await validateRequest();

  if (!session.user) redirect("/login");

  return (
    <SessionProvider value={session}>
      <div className="bg-background flex min-h-screen">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="bg-card sticky top-0 z-10 flex items-center gap-2 border-b p-3 md:hidden">
            <MobileSidebar />
            <Link href="/" className="flex flex-1 items-center gap-2">
              <div className="bg-primary flex h-7 w-7 items-center justify-center rounded-md">
                <MessageCircle
                  size={14}
                  strokeWidth={2.5}
                  className="text-primary-foreground"
                />
              </div>
              <span className="text-foreground text-lg font-bold tracking-tight">
                ChitChat
              </span>
            </Link>
            <ThemeToggle />
            <UserButton />
          </header>

          <div className="bg-card sticky top-0 z-10 hidden items-center gap-3 border-b px-5 py-3 md:flex">
            <SearchField />
            <ThemeToggle className="ms-auto" />
            <UserButton />
          </div>

          <main className="mx-auto w-full max-w-7xl flex-1 p-5">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
