"use server";

import { validateRequest } from "@/auth";
import { syncPostHashtags } from "@/lib/hastags";
import prisma from "@/lib/prisma";
import { getPostDataInclude } from "@/lib/types";
import { createPostSchema } from "@/lib/validation";

export async function submitPost(input: {
  content: string;
  mediaIds: string[];
}) {
  const { user } = await validateRequest();

  if (!user) throw Error("Unauthorized access");

  const { content, mediaIds } = createPostSchema.parse(input);

  const newPost = await prisma.$transaction(async (tx) => {
    const post = await tx.post.create({
      data: {
        content,
        userId: user.id,
        attachments: {
          connect: mediaIds.map((id) => ({ id })),
        },
      },
      include: getPostDataInclude(user.id),
    });
    await syncPostHashtags(tx, post.id, content);
    return post;
  });
  return newPost;
}
