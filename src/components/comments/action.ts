"use server";

import { validateRequest } from "@/auth";
import prisma from "@/lib/prisma";
import { getCommentDataInclude, PostData } from "@/lib/types";
import { createCommentsSchema } from "@/lib/validation";

export async function submitCommnet({
  post,
  content,
}: {
  post: PostData;
  content: string;
}) {
  const { user } = await validateRequest();

  if (!user) throw Error("Unauthorized access");

  const { content: contentValidated } = createCommentsSchema.parse({ content });

  const newComment = await prisma.comments.create({
    data: {
      content: contentValidated,
      postId: post.id,
      userId: user.id,
    },
    include: getCommentDataInclude(user.id),
  });
  return newComment;
}

export async function deleteComment(id: string) {
  const { user } = await validateRequest();

  if (!user) throw Error("Unauthorized access");

  const comment = await prisma.comments.findUnique({
    where: { id },
  });
  if (!comment) throw new Error("Comment not found");

  if (comment.userId !== user.id) throw new Error("Unauthorized");

  const deletedComment = await prisma.comments.delete({
    where: { id },
    include: getCommentDataInclude(user.id),
  });
  return deletedComment;
}
