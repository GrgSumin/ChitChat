import TrendingSidebar from "@/components/TrendingSIdebar";
import Bookmarks from "./Bookmarks";

export const metadata = {
  title: "Bookmarks",
};

export default function Page() {
  return (
    <div className="flex w-full gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="bg-card border-border rounded-2xl border p-5 shadow-sm">
          <h1 className="text-center text-xl font-bold">Bookmarks</h1>
        </div>
        <Bookmarks />
      </div>
      <TrendingSidebar />
    </div>
  );
}
