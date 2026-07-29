import { Prisma } from "@/generated/prisma/client";

export function extractHashtags(content: string): string[] {
  // find every "#word" (letters, numbers, underscore)
  const matches = content.match(/#[\p{L}\p{N}_]+/gu) || [];
  // drop the "#", make lowercase so "#Football" == "#football"
  const tags = matches.map((t) => t.slice(1).toLowerCase());
  // remove duplicates (a post can say #football twice)
  return [...new Set(tags)];
}

export async function syncPostHashtags(
  db: Prisma.TransactionClient,
  postId: string,
  content: string,
) {
  const tags = extractHashtags(content);
  if (tags.length === 0) return;

  for (const tag of tags) {
    const hashtag = await db.hashtag.upsert({
      where: { tag },
      create: { tag },
      update: {},
    });

    await db.postHashtag.upsert({
      where: { postId_hashtagId: { postId, hashtagId: hashtag.id } },
      create: { postId, hashtagId: hashtag.id },
      update: {},
    });
  }
}
