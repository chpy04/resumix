# Project state

_Last updated: 2026-09-18 — end of Wave 0._

**Read this first.** If you are picking this project up cold, read this file, then
`docs/ARCHITECTURE.md`, then the contract docs (`SCHEMA.md`, `API.md`,
`TEMPLATE_TOKENS.md`). `docs/WORKPLAN.md` is the task board;
`docs/DECISIONS.md` explains why things are the way they are.

## Where we are

Wave 0 (foundation) is complete and on `main`:

- Next.js 15 / React 19 / TypeScript / Tailwind v4 skeleton that typechecks.
- `docker-compose.yml` with `db` (postgres:17 on host port **5433**) and `latex`.
- `lib/types.ts` — the shared wire types every other task compiles against.
- `.env.example`, `drizzle.config.ts`, `package.json` scripts.
- All contract docs written and frozen for Wave 1.

Nothing is functional yet: no schema, no API, no renderer, no UI.

## What is in flight

See `docs/WORKPLAN.md` for the live task board. Per-task briefs and completion
reports live in `docs/agents/<task-id>.md`.

## How the pieces fit

A resume never stores text. It stores *which* content ids it picked and in what
order (bridge tables, composite PK, `sort_order`). Editing a bullet is therefore
global and instantly changes every resume that picked it — that is intentional.
Rendering = load selections → substitute into the template's `<<TOKENS>>` →
POST the `.tex` to the latex container → PDF. Saving a PDF snapshots the bytes
into `resume_pdf`, which is what the home page's download button serves, so
later template/content edits do not retroactively change an already-saved resume.

## Conventions

- Branches `feat/<task-id>-<slug>`; worktrees at `../resumix-wt/<task-id>`.
- Commits are imperative, scoped, and small. Every merged task updates this file.
- Server-only code imports from `lib/db/**`; nothing under `components/**` may.
- Ports: web 3000, latex 8080, postgres **5433** (5432 is often already taken).

## Known gaps / next decisions

- Deployment (Vercel + Fly.io + Supabase) is documented but not executed — T11.
- No multi-template UI; the schema supports it, the UI assumes one default.
- PDF storage is `bytea`; swap point is `lib/storage.ts` if it ever outgrows that.
