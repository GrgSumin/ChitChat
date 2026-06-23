import PostEditor from "@/components/posts/editor/PostEditor";
import TrendingSidebar from "@/components/TrendingSIdebar";
import ForYouFeed from "./ForYouFeed";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FollowingFeed from "./FollowingFeed";

export default function Home() {
  return (
    <div className="flex w-full gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <PostEditor />

        <Tabs defaultValue="for-you" className="w-full">
          <TabsList className="bg-card border-border h-14 w-full rounded-2xl border p-1.5 shadow-sm">
            <TabsTrigger
              value="for-you"
              className="h-full flex-1 rounded-2xl text-base font-medium data-active:bg-muted data-active:font-bold dark:data-active:bg-input/30"
            >
              For you
            </TabsTrigger>
            <TabsTrigger
              value="following"
              className="h-full flex-1 rounded-2xl text-base font-medium data-active:bg-muted data-active:font-bold dark:data-active:bg-input/30"
            >
              Following
            </TabsTrigger>
          </TabsList>
          <TabsContent value="for-you" className="mt-2">
            <ForYouFeed />
          </TabsContent>
          <TabsContent value="following" className="mt-2">
            <FollowingFeed />
          </TabsContent>
        </Tabs>
      </div>
      <TrendingSidebar />
    </div>
  );
}
