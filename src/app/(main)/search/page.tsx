import { validateRequest } from "@/auth";
import FollowButton from "@/components/FollowButton";
import SearchField from "@/components/ui/SearchField";
import UserAvatar from "@/components/ui/UserAvatar";
import prisma from "@/lib/prisma";
import { getUserDataSelect } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { Hash, SearchX } from "lucide-react";
import { Metadata } from "next";
import Link from "next/link";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : "Search" };
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q = "" } = await searchParams;
  const { user } = await validateRequest();
  if (!user) return null;

  const query = q.trim();

  const users = query
    ? await prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: query, mode: "insensitive" } },
            { displayName: { contains: query, mode: "insensitive" } },
          ],
        },
        select: getUserDataSelect(user.id),
        take: 10,
      })
    : [];
  const pattern = `%${query.replace(/#/g, "").toLowerCase()}%`;

  const hashtags = query
    ? await prisma.$queryRaw<{ hashtag: string; count: number }[]>`
      SELECT hashtag, COUNT(*)::int AS count
      FROM (
        SELECT LOWER(unnest(regexp_matches(content, '#[[:alnum:]_]+', 'g'))) AS hashtag
        FROM post
      ) AS tags
      WHERE hashtag LIKE ${pattern}
      GROUP BY hashtag
      ORDER BY count DESC, hashtag ASC
      LIMIT 10
    `
    : [];

  return (
    <div className="w-full space-y-5">
      <div className="bg-card border-border rounded-2xl border p-5 shadow-sm">
        <h1 className="text-foreground text-xl font-bold break-all">
          {query ? `Results for "${query}"` : "Search"}
        </h1>
        {/* The header SearchField is desktop-only, so mobile needs its own
            input here or this page would be unusable on a phone. */}
        <div className="mt-3 md:hidden">
          <SearchField />
        </div>
        {!query && (
          <p className="text-muted-foreground mt-1 text-sm">
            Type in the search bar to find people and hashtags.
          </p>
        )}
      </div>

      {users.length > 0 && (
        <section className="bg-card border-border space-y-4 rounded-2xl border p-5 shadow-sm">
          <h2 className="text-foreground font-bold">People</h2>
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3">
              <Link
                href={`/users/${u.username}`}
                className="flex min-w-0 items-center gap-3"
              >
                <UserAvatar avatarUrl={u.avatarUrl} className="flex-none" />

                <div className="min-w-0">
                  <p className="text-foreground line-clamp-1 font-medium hover:underline">
                    {u.displayName}
                  </p>
                  <p className="text-muted-foreground line-clamp-1 text-sm">
                    @{u.username}
                  </p>
                </div>
              </Link>
              <FollowButton
                userId={u.id}
                initialState={{
                  followers: u._count.followers,
                  isFollowedByUser: !!u.followers.length,
                }}
              />
            </div>
          ))}
        </section>
      )}

      {hashtags.length > 0 && (
        <section className="bg-card border-border space-y-3 rounded-2xl border p-5 shadow-sm">
          <h2 className="text-foreground font-bold">Tags</h2>
          {hashtags.map(({ hashtag, count }) => {
            const title = hashtag.split("#")[1];
            return (
              <Link
                key={hashtag}
                href={`/hashtag/${title}`}
                className="hover:bg-muted -mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5"
              >
                <div className="bg-muted text-muted-foreground flex size-10 flex-none items-center justify-center rounded-full">
                  <Hash className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-foreground font-medium">{hashtag}</p>
                  <p className="text-muted-foreground text-sm">
                    {formatNumber(count)} {count === 1 ? "post" : "posts"}
                  </p>
                </div>
              </Link>
            );
          })}
        </section>
      )}

      {query && !users.length && !hashtags.length && (
        <div className="bg-card border-border flex flex-col items-center gap-3 rounded-2xl border p-10 text-center shadow-sm">
          <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
            <SearchX className="size-7" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-foreground text-base font-medium">
              No results found
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              We couldn&apos;t find any people or hashtags for &quot;{query}
              &quot;.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
