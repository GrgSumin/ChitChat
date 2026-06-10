import { Skeleton } from "../ui/skeleton";

export default function PostsLoader() {
  return (
    <div className="space-y-5">
      <PostLoader />
      <PostLoader />
      <PostLoader />
    </div>
  );
}

function PostLoader() {
  return (
    <div className="bg-card w-full space-y-3 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-wrap gap-3">
        <Skeleton className="size-12 rounded-full" />
        <div className="spcae-y-1.5">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-4 w-20 rounded" />
        </div>
      </div>
      <Skeleton className="h-16 rounded" />
    </div>
  );
}
