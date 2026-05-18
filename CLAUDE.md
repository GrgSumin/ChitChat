# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
yarn dev          # Start dev server (http://localhost:3000)
yarn build        # Production build
yarn start        # Start production server
yarn lint         # Run ESLint (flat config: next/core-web-vitals + next/typescript + prettier)
```

### Prisma

```bash
yarn prisma generate        # Regenerate client after schema changes
yarn prisma migrate dev     # Create and apply a migration
yarn prisma db push         # Push schema changes without migration (prototyping)
yarn prisma studio          # Open database browser
```

Prisma config lives in `prisma.config.ts` and reads `DATABASE_URL` from `.env` via dotenv.

No test runner is configured yet.

## Next.js 16 — read the bundled docs first

This project uses **Next.js 16**, which has breaking changes from earlier versions. Before writing any Next.js code, consult the relevant guide in `node_modules/next/dist/docs/` (especially `01-app/`). Do not rely on training-data knowledge of Next.js APIs — check for deprecations and new conventions.

## Architecture

ChitChat is a real-time chat application built with Next.js 16 (App Router, `src/` directory layout). The project is in early stage — scaffolded from create-next-app with key dependencies installed but most features not yet implemented.

**Package manager:** Yarn (yarn.lock present).

### Key technology choices

- **Auth:** Lucia v3 with Arctic (OAuth) and Prisma adapter (`@lucia-auth/adapter-prisma`)
- **Database:** PostgreSQL via Prisma ORM (`@prisma/client` v7 + `prisma` CLI). Schema at `prisma/schema.prisma`, client generated to `src/generated/prisma/` (gitignored). Singleton instance exported from `src/lib/prisma.ts`.
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

### Database schema

Two models currently defined in `prisma/schema.prisma`:

- **User** — `id` (cuid), `username` (unique), `displayName`, optional `email`/`password`/`googleId`/`avatarUrl`/`bio`, timestamps. Has many Sessions (cascade delete).
- **Session** — `id` (cuid), `userId` (FK → User), `expiresAt`. Cascade-deleted with parent User.

Convention: models use `@@map("tablename")` to map PascalCase names to lowercase PostgreSQL table names (e.g., `User` → `users`).

### shadcn/ui conventions

Components are added via the `shadcn` CLI and land in `src/components/ui/`. The utility function `cn()` from `src/lib/utils.ts` merges Tailwind classes. Configuration is in `components.json` (radix-luma style, RSC enabled).
