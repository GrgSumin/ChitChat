import { Metadata } from "next";
import HashtagFeed from "./HashtagFeed";
import TrendingSidebar from "@/components/TrendingSIdebar";

interface PageProps {
  params: Promise<{ tag: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { tag } = await params;
  return { title: `#${tag}` };
}

export default async function HashtagPage({ params }: PageProps) {
  const { tag } = await params;
  return (
    <div className="flex w-full gap-5">
      <div className="min-w-0 flex-1 space-y-5">
        <div className="bg-card border-border rounded-2xl border p-5 shadow-sm">
          <h1 className="text-foreground text-xl font-bold break-all">
            #{tag}
          </h1>
        </div>
        <HashtagFeed tag={tag} />
      </div>
      <TrendingSidebar />
    </div>
  );
}
