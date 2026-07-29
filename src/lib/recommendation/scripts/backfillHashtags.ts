import "dotenv/config";
import { syncPostHashtags } from "@/lib/hastags";
import prisma from "@/lib/prisma";

async function main() {
  const posts = await prisma.post.findMany({
    select: { id: true, content: true },
  });
  console.log(`Found ${posts.length} posts. Backfilling hashtags...`);

  let count = 0;
  for (const post of posts) {
    await syncPostHashtags(prisma, post.id, post.content);
    count++;
    if (count % 20 === 0) console.log(`  ...${count}/${posts.length}`);
  }

  console.log(`✅ Done. Processed ${posts.length} posts.`);
}
main()
  .catch((e) => {
    console.log("Backfill failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
