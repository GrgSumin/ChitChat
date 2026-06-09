import PostEditor from "@/components/posts/editor/PostEditor";
import TrendingSidebar from "@/components/TrendingSIdebar";
import ForYouFeed from "../ForYouFeed";

export default function Home() {
  return (
    <div className="flex w-full gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <PostEditor />
        <ForYouFeed />
      </div>
      <TrendingSidebar />
    </div>
  );
}
