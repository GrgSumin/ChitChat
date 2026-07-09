import kyInstance from "@/lib/ky";
import { BookMarkInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { toast } from "sonner";

interface BookMarkButtonProps {
  postId: string;
  initialState: BookMarkInfo;
}

export default function BookmarkButton({
  postId,
  initialState,
}: BookMarkButtonProps) {
  const queryClient = useQueryClient();

  const queryKey: QueryKey = ["bookmark-info", postId];

  const { data } = useQuery({
    queryKey,
    queryFn: () =>
      kyInstance.get(`/api/posts/${postId}/bookmark`).json<BookMarkInfo>(),
    initialData: initialState,
    staleTime: Infinity,
  });

  const { mutate } = useMutation({
    mutationFn: () =>
      data.isBookMarkedByUser
        ? kyInstance.delete(`/api/posts/${postId}/bookmark`)
        : kyInstance.post(`/api/posts/${postId}/bookmark`),
    onMutate: async () => {
      toast(
        data.isBookMarkedByUser ? "Removed from bookmarks" : "Added to bookmarks",
      );
      await queryClient.cancelQueries({ queryKey });

      const previousState = queryClient.getQueryData<BookMarkInfo>(queryKey);
      queryClient.setQueryData<BookMarkInfo>(queryKey, () => ({
        isBookMarkedByUser: !previousState?.isBookMarkedByUser,
      }));
      return { previousState };
    },
    onError(error, variables, context) {
      queryClient.setQueryData(queryKey, context?.previousState);
      console.log(error);
      toast("Error", {
        description: "Something went wrong . Try again",
      });
    },
  });

  return (
    <button onClick={() => mutate()} className="flex items-center gap-2">
      <Bookmark
        className={cn(
          "size-5",
          data.isBookMarkedByUser && "fill-primary text-primary",
        )}
      />
    </button>
  );
}
