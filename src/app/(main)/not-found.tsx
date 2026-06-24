import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex w-full justify-center py-12">
      <div className="bg-card border-border flex max-w-md flex-col items-center gap-4 rounded-2xl border p-10 text-center shadow-sm">
        <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
          <Compass className="size-7" strokeWidth={1.5} />
        </div>
        <div className="space-y-1">
          <h1 className="text-foreground text-2xl font-bold">Page not found</h1>
          <p className="text-muted-foreground text-sm">
            The page you&apos;re looking for doesn&apos;t exist or may have been
            moved.
          </p>
        </div>
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}
