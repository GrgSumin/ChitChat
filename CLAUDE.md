# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
yarn dev          # Start custom server (tsx server.ts) on http://localhost:3000 — Next + Socket.IO
yarn build        # Production build (next build)
yarn start        # Start production server (NODE_ENV=production tsx server.ts)
yarn lint         # Run ESLint (flat config: eslint.config.mjs — next/core-web-vitals + next/typescript + prettier)
```

**There is no `next dev` / `next start`.** The app runs through a **custom HTTP server** (`server.ts`) that boots Next's request handler *and* attaches a Socket.IO server (see Real-time below). Always start it via `yarn dev` / `yarn start` so websockets work — running `next dev` directly gives you no chat/presence.

### Prisma

```bash
yarn prisma generate        # Regenerate client after schema changes
yarn prisma db push         # Push schema changes to the DB (this project's workflow — no migration files)
yarn prisma studio          # Open database browser
```

Prisma config lives in `prisma.config.ts` (loads `dotenv/config`, points `schema` at `prisma/schema.prisma`, and supplies `datasource.url` from `process.env.DATABASE_URL`). The `prisma/migrations` directory is empty — the project prototypes with `db push`, not migrations. Note the schema's `datasource` block has **no `url`**; the connection string is provided at runtime by the **`@prisma/adapter-pg` driver adapter** wired up in `src/lib/prisma.ts` (`new PrismaPg({ connectionString: DATABASE_URL })`), and by `prisma.config.ts` for the CLI.

No test runner is configured yet.

## Next.js 16 — read the bundled docs first

This project uses **Next.js 16**, which has breaking changes from earlier versions. Before writing any Next.js code, consult the relevant guide in `node_modules/next/dist/docs/` (especially `01-app/`). Do not rely on training-data knowledge of Next.js APIs — check for deprecations and new conventions.

## Architecture

ChitChat is a Twitter-style social app built with Next.js 16 (App Router, `src/` directory layout). Implemented so far: email/password + Google OAuth auth; posts with a Tiptap editor and media attachments; For You / Following feeds; follow/unfollow; user profiles with avatar upload; hover-card user tooltips; **likes, comments, bookmarks**; **notifications** (like/follow/comment, with unread-count polling); **user & hashtag search** (results page + live typeahead) and clickable `#hashtag` pages; an **explore** page; **real-time direct & group messaging** over Socket.IO (chat list, conversation window, presence, typing indicators, unread counts); and an **ML recommendation engine** (separate Python service) powering the ranked Home and Explore feeds.

**Package manager:** Yarn (yarn.lock present).

### Key technology choices

- **Auth:** Lucia v3 with Arctic (OAuth) and Prisma adapter (`@lucia-auth/adapter-prisma`). Session cookie name is `auth_session`.
- **Database:** PostgreSQL via Prisma ORM (`@prisma/client` v7 + `prisma` CLI) using the **`@prisma/adapter-pg` driver adapter** (not the default engine). Schema at `prisma/schema.prisma`, client generated to `src/generated/prisma/` (gitignored, `provider = "prisma-client"`). Singleton instance exported from `src/lib/prisma.ts`.
- **Real-time:** Socket.IO (`socket.io` server + `socket.io-client`) — see the Real-time section below.
- **Data fetching:** TanStack React Query v5
- **Rich text editor:** Tiptap v3 (starter-kit + placeholder extension)
- **File uploads:** UploadThing
- **UI components:** shadcn/ui (radix-luma style, Radix UI primitives, Lucide icons)
- **Styling:** Tailwind CSS v4 with CSS variables for theming (`globals.css`), tw-animate-css
- **HTTP client:** ky
- **Toasts:** sonner (shadcn wrapper at `src/components/ui/sonner.tsx`)
- **Theming:** next-themes (class-based dark mode)
- **Date handling:** date-fns
- **Image handling:** react-cropper, react-image-file-resizer
- **Infinite scroll / lazy load:** react-intersection-observer
- **Link detection:** react-linkify-it
- **Formatting:** Prettier with `prettier-plugin-tailwindcss`

### Path aliases

`@/*` maps to `./src/*` (configured in tsconfig.json).

### Notable configuration

- **Client-side router cache:** `next.config.ts` sets `experimental.staleTimes.dynamic` to 30 seconds, so dynamic pages are served from the client cache for 30s before re-fetching.
- **Dark mode:** Uses class-based dark mode (`&:is(.dark *)` custom variant in `globals.css`). Theme colors are defined as CSS variables using oklch in `:root` / `.dark` selectors.
- **Fonts:** Noto Sans (`--font-sans`, primary), Geist Sans, and Geist Mono are loaded via `next/font/google` in the root layout.
- **Page titles:** Root layout uses a `title.template` of `"%s | Chitchat"` — individual pages only need to export their own title string.

### Request & data-flow patterns

These conventions span many files — follow them when adding features:

- **Auth gate:** `validateRequest()` in `src/auth.ts` (a React-`cache`'d wrapper over Lucia session validation) is the single source of truth for the current user. The `(main)` route-group layout calls it and `redirect("/login")`s if there's no user, so all pages under it are auth-protected. Server actions and API routes each call `validateRequest()` again and throw / return 401 — never trust the layout gate alone.
- **Reads (paginated feeds) go through API routes**, not server actions: `src/app/api/**/route.ts` handlers do cursor-based pagination (`take: pageSize + 1`, derive `nextCursor`, return a `PostsPage`), fetched client-side with ky (`src/lib/ky.ts`) + React Query `useInfiniteQuery`, rendered inside `InfiniteScrollContainer`.
- **Writes go through server actions** (`"use server"` files named `action.ts`), wrapped in a React Query `useMutation` hook (`mutation.ts` / `mutaion.ts` — note the existing typo in `users/[username]/`). Mutations do **optimistic cache surgery**: they match queries by predicate on the shared `["post-feed", ...]` query key and patch `InfiniteData<PostsPage>` in place (see `components/posts/editor/mutation.ts`). New feeds must use compatible query keys to stay in sync.
- **Prisma select/include shapes are centralized** in `src/lib/types.ts`: `getUserDataSelect(loggedInUserId)` / `getPostDataInclude(loggedInUserId)` return `satisfies`-typed selects (including a scoped `followers` where-clause used to compute `isFollowedByUser`, and `_count`). Reuse these everywhere you fetch a user/post so the derived `UserData` / `PostData` types stay accurate — don't hand-roll selects.
- **Validation:** all input parsed with Zod schemas from `src/lib/validation.ts` (`requiredString` is the shared trimmed-non-empty base). Forms use react-hook-form + `@hookform/resolvers`.
- **Session on the client:** `SessionProvider` (in `(main)`) exposes the validated user via `useSession()`.

### Real-time (Socket.IO)

Messaging, presence, and typing indicators do **not** go through API routes or server actions — they run over a single Socket.IO connection:

- **Server:** `server.ts` creates the HTTP server, hands requests to Next, then calls `createSocketServer(httpServer)` from `src/socket/index.ts`. All socket logic lives in that one file.
- **Handshake auth:** an `io.use(...)` middleware reads the `auth_session` cookie from the handshake headers, validates the Lucia session against Prisma, and stashes the user on `socket.data.user`. Unauthenticated sockets are rejected. This is the socket-layer equivalent of `validateRequest()` — every handler trusts `socket.data.user.id`.
- **Rooms:** each socket joins `chat:${chatId}` for every chat it participates in (on connect, and again when a new chat is created). Messages/typing are emitted to those rooms; handlers re-check membership (`prisma.chatParticipant` / `socket.rooms.has(...)`) before acting — never trust the client's `chatId` alone.
- **Presence:** an in-memory `Map<userId, Set<socketId>>` (`onlineUsers`) tracks online users across tabs. Connect emits `presence:online` only on the first tab; disconnect emits `presence:offline` only when the last tab closes. New sockets get the full snapshot via `presence:state`.
- **Events are centrally typed** in `src/lib/types.ts` as `ClientToServerEvents` / `ServerToClientEvents` (e.g. `chat:create`, `message:send`, `chat:read`, `typing:start/stop` → `chat:new`, `message:new`, `typing`, `presence:*`). The `Server<...>` and client `Socket<...>` are parameterized with these, so both ends stay in sync — add new events here first.
- **Client:** `src/components/SocketProvider.tsx` (mounted in the `(main)` layout inside `SessionProvider`) opens the connection with `io()`, exposes it via `useSocket()` (`{ socket, onlineUsers }`), and bridges socket events into the React Query cache — appending `message:new` into `["messages", chatId]` `InfiniteData` and invalidating `["chats"]` / `["unread-messages-count"]`. Because socket payloads are JSON, it runs `reviveDates()` to turn any `*At` string field back into a `Date` before caching.
- **Chat DB reads** (initial message history, chat list, unread counts) still use the normal API-route + `useInfiniteQuery` pattern under `src/app/api/chats/**`; only the live push/mutations go over the socket.

### Recommendation engine (Python ML service)

Feed ranking does **not** live in the Next.js app. It runs in `ml-service/` — a
FastAPI + NumPy service that reads Postgres directly with psycopg (deliberately
**not** through Prisma) and serves ranked post IDs over HTTP. See
`ml-service/README.md` for full detail.

- **The model is learned, not a formula.** `app/model_cf.py` implements Bayesian
  Personalised Ranking matrix factorisation (BPR-MF) from scratch in NumPy: latent
  user/post vectors trained by SGD on the implicit like/bookmark/comment matrix.
  Signals are weighted (like 1.0, bookmark 1.5, comment 2.0) via sampling frequency.
- **Hybrid of three scorers**, min–max normalised then blended:
  content (TF-IDF over hashtags, cosine) + collaborative (BPR) + popularity
  (time-decayed engagement). Popularity is a **cold-start fallback**, not the mechanism —
  `app/hybrid.py` ramps CF in as a user accumulates history.
- **Hyper-parameters and blend weights are fitted**, not guessed — `app/tune.py` grid-searches
  them on a validation fold carved out of the *training* data, never the test set.
- **Evaluation** (`app/evaluate.py`) uses a **temporal** 80/20 split and reports
  precision@k / recall@k / NDCG@k / coverage / novelty against four baselines
  (random, popularity, content-only, CF-only). Results feed Chapter 7 of `report_gen.py`.
- **Serving:** `GET /recommend/{userId}?feed=home|explore` returns IDs only; the Next.js
  route hydrates rows via `getPostDataInclude` so select shapes stay in one place.
  The service retrains itself every 15 minutes.

**Next.js side** (`src/lib/recommendation/`):
- `client.ts` — ky wrapper. **Never throws**; returns `null` on any failure so the feed
  degrades to reverse-chronological rather than breaking.
- `feed.ts` — `buildRankedIds` (FeedCache, 10-min TTL), `blendFeed` (3:2 followed:recommended
  for Home, per report UC-07), `hydrateInOrder` (**re-sorts after `WHERE id IN`**, since Postgres
  returns those rows in arbitrary order and would otherwise silently discard the ranking).
- **Ranked feeds paginate by INDEX into the cached list**, not by post id — the ordering
  isn't in the database. The fallback path still uses id cursors. Both return `PostsPage`,
  so no client component changed.

Run it with `docker compose up ml` (host port **8001** — 8000 is taken by another local
project) or `uvicorn app.main:app --port 8001`. `ML_SERVICE_URL` configures the app.

**Seeding:** `yarn seed` generates the synthetic dataset. Its difficulty parameters are
load-bearing — mixed interests (65/25/10), a viral-post popularity confound, and power-law
activity exist so the evaluation can actually discriminate between methods. Making the data
"cleaner" makes every method score near-perfect and the comparison meaningless.

### Database schema

Models in `prisma/schema.prisma` (all use `@@map(...)` to map PascalCase model names to lowercase PostgreSQL tables; note `Post` maps to `post` singular while most others are plural):

- **User** — `id` (cuid), `username` (unique), `displayName`, optional `email`/`password`/`googleId`/`avatarUrl`/`bio`, timestamps. Related to Sessions, Posts, Follows (both sides), Likes, BookMarks, Comments, Notifications (as recipient + issuer), ChatParticipants, and sent Messages.
- **Session** — `id`, `userId` (FK → User), `expiresAt`. Cascade-deleted with parent User.
- **Follow** — join table with composite `@@unique([followerId, followingId])`; `follower` uses the `"Following"` relation and `following` uses `"Followers"` (named relations because both FKs point at User).
- **Post** — `id`, `content`, `userId` (FK → User), `createdAt`; has many Media (`attachments`), Likes, BookMarks, Comments, and linked Notifications.
- **Media** — polymorphic-ish attachment: optional `postId` **or** `messageId` (both `SetNull` on delete), a `type` (`MediaType` enum: `IMAGE`/`VIDEO`), and `url`. Uploaded via UploadThing; rows are created unattached and later `connect`ed to a post or message.
- **Comments**, **Like**, **BookMark** — each links a User to a Post. `Like` and `BookMark` have `@@unique([userId, postId])`. All three carry `createdAt` — `Like.createdAt` was added specifically so the recommender's temporal train/test split has a timestamp for its strongest signal.
- **Notification** — `recipientId` + `issuerId` (both → User via named relations), optional `postId`, `type` (`NotificationType`: `LIKE`/`FOLLOW`/`COMMENT`), `read` boolean.
- **Chat** — `isGroup` flag, optional `name` (groups only), `lastMessageAt` (bumped on each send for ordering the chat list). Has many ChatParticipants and Messages.
- **ChatParticipant** — join table between Chat and User with `lastReadAt` (drives unread counts) and `@@unique([chatId, userId])`.
- **Message** — `content`, `chatId`, `senderId`, optional Media `attachments`, `createdAt`.

The generated client lives at `src/generated/prisma/` — import `Prisma`/types from `@/generated/prisma/client`. As with users/posts, chat/message/notification **select & include shapes are centralized in `src/lib/types.ts`** (`chatInclude`, `messageInclude`, `notificationInclude`, `chatUserSelect`, plus their derived `ChatData`/`MessageData`/`NotificationData` types and `*Page` cursor-pagination shapes) — reuse them; the socket server and API routes both depend on these staying consistent.

### shadcn/ui conventions

Components are added via the `shadcn` CLI and land in `src/components/ui/`. The utility function `cn()` from `src/lib/utils.ts` merges Tailwind classes. Configuration is in `components.json` (radix-luma style, RSC enabled).
