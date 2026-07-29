import { Metadata } from "next";
import ExploreFeed from "./ExploreFeed";

export const metadata: Metadata = {
  title: "Explore",
};

export default function ExplorePage() {
  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="bg-card border-border rounded-2xl border p-5 shadow-sm">
        <h1 className="text-foreground text-xl font-bold">Explore</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Posts we think you&apos;ll like, from people you don&apos;t follow yet.
        </p>
      </div>
      <ExploreFeed />
    </div>
  );
}
