# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
yarn dev          # Start dev server (http://localhost:3000)
yarn build        # Production build
yarn start        # Start production server
yarn lint         # Run ESLint (flat config, eslint.config.mjs)
```

No test runner is configured yet.

## Architecture

ChitChat is a real-time chat application built with **Next.js 16** (App Router) using the `src/` directory layout. The project is in early stage — scaffolded from create-next-app with key dependencies installed but most features not yet implemented.

**Package manager:** Yarn (yarn.lock present).

### Key technology choices

- **Auth:** Lucia v3 with Arctic (OAuth) and Prisma adapter (`@lucia-auth/adapter-prisma`)
- **Database:** Prisma ORM (`@prisma/client` + `prisma` CLI) — no schema file yet
- **Data fetching:** TanStack React Query v5
- **Rich text editor:** Tiptap v3 (starter-kit + placeholder extension)
- **File uploads:** UploadThing
- **UI components:** shadcn/ui (radix-luma style, Radix UI primitives, Lucide icons)
- **Styling:** Tailwind CSS v4 with CSS variables for theming (`globals.css`), tw-animate-css
- **HTTP client:** ky
- **Formatting:** Prettier with `prettier-plugin-tailwindcss`

### Path aliases

`@/*` maps to `./src/*` (configured in tsconfig.json).

### shadcn/ui conventions

Components are added via the `shadcn` CLI and land in `src/components/ui/`. The utility function `cn()` from `src/lib/utils.ts` merges Tailwind classes. Configuration is in `components.json` (radix-luma style, RSC enabled).
