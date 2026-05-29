import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explore",
};

export default function ExplorePage() {
  return (
    <div className="bg-card border-border rounded-2xl border p-8">
      <h1 className="text-foreground text-xl font-bold">Explore</h1>
      <p className="text-muted-foreground mt-1 text-sm">Coming soon.</p>
    </div>
  );
}
