import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import prisma from "@/lib/prisma";
import { hash } from "@node-rs/argon2";
import { Prisma } from "@/generated/prisma/client";
import { syncPostHashtags } from "@/lib/hastags";
import { TOPICS } from "@/lib/recommendation/topics";

/**
 * Synthetic dataset generator for the recommendation engine.
 *
 * ===================  WHY THIS IS DELIBERATELY MESSY  ===================
 * The obvious way to build this data — give every user one topic and have
 * them engage only within it — produces a dataset that is PERFECTLY
 * SEPARABLE. On data like that a one-line "match the user's tag" heuristic
 * scores near-perfect precision@k, every method ties at the ceiling, and the
 * evaluation can no longer distinguish a good recommender from a trivial one.
 * Reporting a hybrid "beating the baselines" on such data measures the
 * generator, not the model.
 *
 * So this generator injects four kinds of difficulty on purpose:
 *
 *  1. MIXED INTERESTS — engagement is 65% primary topic, 25% secondary,
 *     10% uniformly random. Users are not pure, so tag-matching alone cannot
 *     be perfect.
 *  2. POPULARITY CONFOUND — a small set of "viral" posts attracts engagement
 *     from every topic. This decorrelates popularity from relevance, which is
 *     what stops the popularity baseline from being accidentally unbeatable.
 *  3. POWER-LAW ACTIVITY — a few heavy users, a long tail of sparse ones, and
 *     some with almost nothing. This is what actually exercises cold-start
 *     instead of leaving it as an untested branch.
 *  4. REAL TIMESTAMPS ON EVERY SIGNAL — including likes. The evaluation uses a
 *     temporal split, so interactions sharing one timestamp would collapse it.
 *
 * Ground truth (each user's true topic mix) is written to
 * `prisma/seed-ground-truth.json` so the evaluation can measure against known
 * intent rather than inferring it.
 */

// sentence templates — {topic} gets swapped for the topic name
const TEMPLATES = [
  "Loving everything about {topic} lately!",
  "Can't stop thinking about {topic} 🔥",
  "Anyone else really into {topic} right now?",
  "Just had the best {topic} experience 🙌",
  "My whole weekend was about {topic}.",
  "Here's why {topic} is so underrated.",
  "Big {topic} energy today ⚡",
  "New {topic} obsession, honestly no regrets.",
];

const COMMENT_TEMPLATES = [
  "This is so true!",
  "Completely agree with this.",
  "Been saying this for ages 👏",
  "Great take, thanks for sharing.",
  "Needed to read this today.",
  "Okay this is actually a good point.",
];

const FIRST_NAMES = [
  "Alex",
  "Sam",
  "Jordan",
  "Riya",
  "Leo",
  "Mia",
  "Noah",
  "Zoe",
  "Kai",
  "Ella",
];
const LAST_NAMES = [
  "Sharma",
  "Lee",
  "Khan",
  "Smith",
  "Patel",
  "Garcia",
  "Brown",
  "Gurung",
];

// ---- tuning knobs (the "difficulty" of the dataset) ----
const USER_COUNT = 100;
const POSTS_PER_USER = 6;
const DAYS_OF_HISTORY = 60;

/** Share of engagement drawn from the user's primary / secondary topic.
 *  The remainder is uniformly random across all topics. */
const PRIMARY_SHARE = 0.65;
const SECONDARY_SHARE = 0.25;

/** Fraction of posts that go "viral" and attract cross-topic engagement. */
const VIRAL_POST_SHARE = 0.05;
/**
 * How many extra engagements each viral post receives.
 *
 * CALIBRATION MATTERS HERE, in both directions. At 0 the popularity baseline
 * is trivially beatable and the comparison is uninteresting. Set it too high
 * and viral engagement becomes the MAJORITY of all interactions — popularity
 * stops being a confound and simply becomes relevance, the topical signal is
 * drowned, and the content scorer collapses to near-random. Keep total viral
 * engagement to roughly 10% of all interactions.
 */
const VIRAL_ENGAGEMENT = 6;

/** Fraction of follows that cross topic boundaries (social noise). */
const CROSS_TOPIC_FOLLOW_SHARE = 0.25;

// ---- helpers ----
function randInt(max: number) {
  return Math.floor(Math.random() * max);
}
function pick<T>(arr: T[]): T {
  return arr[randInt(arr.length)];
}
function pickSome<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    out.push(copy.splice(randInt(copy.length), 1)[0]);
  }
  return out;
}
function randomPastDate(days: number): Date {
  const msAgo = randInt(days * 24 * 60 * 60 * 1000);
  return new Date(Date.now() - msAgo);
}

/**
 * Pareto-ish draw: most users land low, a few land very high.
 * Real social engagement is heavy-tailed, and a uniform draw would give every
 * user a comfortable amount of history — quietly removing the cold-start users
 * the recommender most needs to be tested on.
 */
function powerLawCount(min: number, max: number, alpha = 1.6): number {
  const u = Math.random();
  const raw = min / Math.pow(1 - u * (1 - Math.pow(min / max, alpha)), 1 / alpha);
  return Math.min(max, Math.max(min, Math.round(raw)));
}

type SeedUser = {
  id: string;
  primary: string;
  secondary: string;
};
type SeedPost = {
  id: string;
  topic: string;
  authorId: string;
  createdAt: Date;
  viral: boolean;
};

// ---- 1) users ----
async function createUsers(): Promise<SeedUser[]> {
  const passwordHash = await hash("password123");
  const users: SeedUser[] = [];
  for (let i = 0; i < USER_COUNT; i++) {
    const primary = TOPICS[i % TOPICS.length];
    // Secondary topic is offset rather than random so every topic pair is
    // represented evenly — avoids accidental clusters the model could exploit.
    const secondary = TOPICS[(i + 1 + randInt(TOPICS.length - 1)) % TOPICS.length];

    const user = await prisma.user.create({
      data: {
        username: `seed_${i}`,
        displayName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        password: passwordHash,
        bio: `Into ${primary.name} and a bit of ${secondary.name}.`,
        onboardedAt: new Date(),
      },
    });
    users.push({
      id: user.id,
      primary: primary.name,
      secondary: secondary.name,
    });
  }
  console.log(`✅ Created ${users.length} users.`);
  return users;
}

// ---- 2) posts ----
async function createPosts(users: SeedUser[]): Promise<SeedPost[]> {
  const posts: SeedPost[] = [];
  let imageLock = 0;

  for (const user of users) {
    for (let i = 0; i < POSTS_PER_USER; i++) {
      // Authors mostly post in their primary topic but not exclusively —
      // otherwise author identity would perfectly predict topic.
      const topicName = Math.random() < 0.8 ? user.primary : user.secondary;
      const topicDef = TOPICS.find((t) => t.name === topicName)!;

      const sentence = pick(TEMPLATES).replace("{topic}", topicName);
      const tags = pickSome(topicDef.tags, 1 + randInt(3));
      const content = `${sentence} ${tags.map((t) => `#${t}`).join(" ")}`;
      const createdAt = randomPastDate(DAYS_OF_HISTORY);

      const post = await prisma.post.create({
        data: { content, userId: user.id, createdAt },
      });

      if (Math.random() < 0.4) {
        await prisma.media.create({
          data: {
            type: "IMAGE",
            url: `https://loremflickr.com/600/400/${topicName}?lock=${imageLock++}`,
            postId: post.id,
          },
        });
      }

      await syncPostHashtags(prisma, post.id, content);
      posts.push({
        id: post.id,
        topic: topicName,
        authorId: user.id,
        createdAt,
        viral: false,
      });
    }
  }

  // Mark the popularity confound.
  for (const p of pickSome(posts, Math.round(posts.length * VIRAL_POST_SHARE))) {
    p.viral = true;
  }

  console.log(
    `✅ Created ${posts.length} posts (${posts.filter((p) => p.viral).length} viral).`,
  );
  return posts;
}

/** Pick the topic this particular engagement will be drawn from. */
function rollTopic(user: SeedUser): string {
  const r = Math.random();
  if (r < PRIMARY_SHARE) return user.primary;
  if (r < PRIMARY_SHARE + SECONDARY_SHARE) return user.secondary;
  return pick(TOPICS).name;
}

/**
 * An interaction timestamp must be AFTER the post existed, otherwise the
 * temporal split can train on an engagement that chronologically precedes its
 * own post. Draw uniformly from (post creation -> now).
 */
function engagementDate(post: SeedPost): Date {
  const start = post.createdAt.getTime();
  const span = Date.now() - start;
  return new Date(start + randInt(Math.max(span, 1)));
}

// ---- 3) engagement ----
async function createEngagement(users: SeedUser[], posts: SeedPost[]) {
  const followRows: Prisma.FollowCreateManyInput[] = [];
  const likeRows: Prisma.LikeCreateManyInput[] = [];
  const bookmarkRows: Prisma.BookMarkCreateManyInput[] = [];
  const commentRows: Prisma.CommentsCreateManyInput[] = [];
  const notificationRows: Prisma.NotificationCreateManyInput[] = [];

  // Index posts by topic once — this loop is otherwise O(users * posts).
  const byTopic = new Map<string, SeedPost[]>();
  for (const p of posts) {
    if (!byTopic.has(p.topic)) byTopic.set(p.topic, []);
    byTopic.get(p.topic)!.push(p);
  }
  const viralPosts = posts.filter((p) => p.viral);

  // De-dup guards: the schema has @@unique([userId, postId]) on likes and
  // bookmarks, and createMany({ skipDuplicates }) would silently drop rows,
  // making the real interaction count differ from what we report.
  const likeSeen = new Set<string>();
  const bookmarkSeen = new Set<string>();
  const commentSeen = new Set<string>();

  for (const user of users) {
    // --- follows: mostly same-topic, deliberately not exclusively ---
    const sameTopic = users.filter(
      (u) => u.id !== user.id && u.primary === user.primary,
    );
    const others = users.filter(
      (u) => u.id !== user.id && u.primary !== user.primary,
    );
    const followCount = powerLawCount(2, 20);
    const crossCount = Math.round(followCount * CROSS_TOPIC_FOLLOW_SHARE);
    for (const t of pickSome(sameTopic, followCount - crossCount)) {
      followRows.push({ followerId: user.id, followingId: t.id });
    }
    for (const t of pickSome(others, crossCount)) {
      followRows.push({ followerId: user.id, followingId: t.id });
    }

    // --- engagement volume: heavy-tailed ---
    // The floor is low enough that some users land near cold-start while the
    // tail gives a handful of users enough history for CF to learn from.
    //
    // DENSITY MATTERS FOR CF. Collaborative filtering can only relate two
    // users if they engaged with the SAME post, so what governs whether it
    // works at all is interactions / (users * posts). At ~2% density CF has
    // almost no co-engagement to learn from and scores near random -- which
    // makes the CF baseline a measurement of the dataset rather than of the
    // model. MovieLens-100k, the standard benchmark, is ~6% dense; these
    // numbers target a comparable range.
    const engagementCount = powerLawCount(18, 320, 1.25);

    for (let n = 0; n < engagementCount; n++) {
      const topic = rollTopic(user);
      const candidates = (byTopic.get(topic) ?? []).filter(
        (p) => p.authorId !== user.id,
      );
      if (candidates.length === 0) continue;
      const post = pick(candidates);
      const at = engagementDate(post);
      const key = `${user.id}:${post.id}`;

      // Signal mix: likes are cheap and common, comments rare and costly.
      const roll = Math.random();
      if (roll < 0.7) {
        if (likeSeen.has(key)) continue;
        likeSeen.add(key);
        likeRows.push({ userId: user.id, postId: post.id, createdAt: at });
        notificationRows.push({
          recipientId: post.authorId,
          issuerId: user.id,
          postId: post.id,
          type: "LIKE",
          createdAt: at,
        });
      } else if (roll < 0.9) {
        if (bookmarkSeen.has(key)) continue;
        bookmarkSeen.add(key);
        bookmarkRows.push({ userId: user.id, postId: post.id, createdAt: at });
      } else {
        if (commentSeen.has(key)) continue;
        commentSeen.add(key);
        commentRows.push({
          userId: user.id,
          postId: post.id,
          content: pick(COMMENT_TEMPLATES),
          createdAt: at,
        });
        notificationRows.push({
          recipientId: post.authorId,
          issuerId: user.id,
          postId: post.id,
          type: "COMMENT",
          createdAt: at,
        });
      }
    }
  }

  // --- the popularity confound ---
  // Viral posts pull engagement from users regardless of topic affinity. This
  // is what makes "popular" and "relevant to you" different questions, which
  // is the entire point of having a popularity baseline to beat.
  for (const post of viralPosts) {
    for (const user of pickSome(users, VIRAL_ENGAGEMENT)) {
      if (user.id === post.authorId) continue;
      const key = `${user.id}:${post.id}`;
      if (likeSeen.has(key)) continue;
      likeSeen.add(key);
      likeRows.push({
        userId: user.id,
        postId: post.id,
        createdAt: engagementDate(post),
      });
    }
  }

  await prisma.follow.createMany({ data: followRows, skipDuplicates: true });
  await prisma.like.createMany({ data: likeRows, skipDuplicates: true });
  await prisma.bookMark.createMany({
    data: bookmarkRows,
    skipDuplicates: true,
  });
  await prisma.comments.createMany({ data: commentRows });
  await prisma.notification.createMany({ data: notificationRows });

  console.log(
    `✅ ${followRows.length} follows, ${likeRows.length} likes, ` +
      `${bookmarkRows.length} bookmarks, ${commentRows.length} comments.`,
  );
}

// ---- 4) explicit interests ----
async function createUserInterests(users: SeedUser[]) {
  const tagId = new Map<string, string>();
  for (const topic of TOPICS) {
    for (const tag of topic.tags) {
      if (tagId.has(tag)) continue;
      const hashtag = await prisma.hashtag.upsert({
        where: { tag },
        create: { tag },
        update: {},
      });
      tagId.set(tag, hashtag.id);
    }
  }

  const rows: Prisma.UserInterestCreateManyInput[] = [];
  for (const user of users) {
    // Declared interests mirror the true mix, with the secondary topic scored
    // lower — this is the ONLY signal available for a cold-start user, so it
    // has to be informative without being a perfect oracle.
    const primaryDef = TOPICS.find((t) => t.name === user.primary)!;
    const secondaryDef = TOPICS.find((t) => t.name === user.secondary)!;
    for (const tag of primaryDef.tags) {
      rows.push({ userId: user.id, hashtagId: tagId.get(tag)!, score: 1 });
    }
    for (const tag of secondaryDef.tags) {
      if (primaryDef.tags.includes(tag)) continue;
      rows.push({ userId: user.id, hashtagId: tagId.get(tag)!, score: 0.4 });
    }
  }

  await prisma.userInterest.createMany({ data: rows, skipDuplicates: true });
  console.log(`✅ Created ${rows.length} user interests.`);
}

// ---- 5) ground truth ----
function writeGroundTruth(users: SeedUser[]) {
  const out = {
    generatedAt: new Date().toISOString(),
    config: {
      USER_COUNT,
      POSTS_PER_USER,
      DAYS_OF_HISTORY,
      PRIMARY_SHARE,
      SECONDARY_SHARE,
      VIRAL_POST_SHARE,
      VIRAL_ENGAGEMENT,
      CROSS_TOPIC_FOLLOW_SHARE,
    },
    users: users.map((u) => ({
      userId: u.id,
      primaryTopic: u.primary,
      secondaryTopic: u.secondary,
    })),
  };
  const file = path.join(process.cwd(), "prisma", "seed-ground-truth.json");
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`✅ Ground truth written to ${file}`);
}

// ---- main ----
async function main() {
  await prisma.user.deleteMany({
    where: { username: { startsWith: "seed_" } },
  });

  const users = await createUsers();
  const posts = await createPosts(users);
  await createEngagement(users, posts);
  await createUserInterests(users);
  writeGroundTruth(users);

  console.log(
    `🌱 Seed complete: ${users.length} users, ${posts.length} posts.`,
  );
}

main()
  .catch((e) => {
    console.error("Seed failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
