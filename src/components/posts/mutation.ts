import { PostsPage } from "@/lib/types";
import {
  InfiniteData,
  QueryFilters,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { deletePost } from "./action";
import { toast } from "sonner";

export function useDeletePostMutation() {
  const queryClient = useQueryClient();

  const router = useRouter();
  const pathname = usePathname();

  const mutation = useMutation({
    mutationFn: deletePost,
    onSuccess: async (deletedPost) => {
      const queryfilter: QueryFilters = { queryKey: ["post-feed"] };

      await queryClient.cancelQueries(queryfilter);

      queryClient.setQueriesData<InfiniteData<PostsPage, string | null>>(
        queryfilter,
        (oldData) => {
          if (!oldData) return;

          return {
            pageParams: oldData.pageParams,
            pages: oldData.pages.map((page) => ({
              nextCursor: page.nextCursor,
              posts: page.posts.filter((p) => p.id !== deletedPost.id),
            })),
          };
        },
      );

      toast.success("Sucess", { description: "Post Deleted" });

      if (pathname === `/posts/${deletedPost.id}`) {
        router.push(`/users/${deletedPost.user.username}`);
      }
    },
    onError(error) {
      console.error(error);
      toast.error("Error", {
        description: "Failed to delete post. Please try again",
      });
    },
  });
  return mutation;
}
