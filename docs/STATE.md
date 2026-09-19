# Project state

_Last updated: 2026-09-18 — Wave 1 complete, Wave 2 in flight._

**Read this first.** If you are picking this project up cold, read this file, then
`docs/ARCHITECTURE.md`, then the contract docs (`SCHEMA.md`, `API.md`,
`TEMPLATE_TOKENS.md`). `docs/WORKPLAN.md` is the task board;
`docs/DECISIONS.md` explains why things are the way they are.

## Where we are

Waves 0 and 1 are complete and merged to `main`:

- **Foundation** — Next.js 15 / React 19 / TS / Tailwind v4 skeleton, `docker-compose.yml`
  (`db` on host port **5433**, `latex` on 8080), `lib/types.ts`, contract docs.
- **T1 database** — all 15 tables, hand-written `drizzle/0000_init.sql`, idempotent
  `scripts/migrate.ts`. Composite PKs and partial unique indexes verified against a live DB.
- **T2 latex service** — `services/latex/` Debian + TeX Live image, zero-dependency
  `node:http` server, non-root, `-no-shell-escape`, 20s timeout, bounded concurrency.
  Verified: the real V1 resume compiles to a 1-page PDF in ~380ms.
- **T3 render engine** — pure `renderResume()`, `<<TOKEN>>` substitution, `DEFAULT_TEMPLATE`
  derived from the V1 resume. 17 tests including the V1 round-trip.
- **T4 auth** — Web Crypto HMAC token (Edge-safe), timing-safe compares, fail-closed on
  missing env, middleware over `/api/*`, no-flash `AuthGate`. 11 tests.
- **Amendment D-013** — `technical_skill_row.separator` (migration `0001`). The renderer had
  hardcoded `', '`; the real resume joins Additional Information rows with `' $|$ '`, so the
  smoke test could not pass. The T3 test had been rewriting the reference file's pipes into
  commas to compensate; that adjustment was removed and the round-trip now compares verbatim.

Wave 2/3 progress:

- **T5 seed + smoke** — `npm run db:seed` loads the V1 resume content and a fully-selected
  Default resume; `npm run smoke` reads it back **out of the database**, renders, diffs
  against `docs/reference/v1-resume.tex`, and compiles it through the real latex sidecar.
  **Verified passing: round-trip match + `ok=true, pages=1`.** The spec's governing
  constraint — "I should always be able to represent my current resume" — is met.
- **T7 home page** — resume grid, fuzzy search, per-card download of the saved snapshot.

The API (T6) is the last thing standing between this and a running app; the editor
(T8/T9) has not started.

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
- **Serverless pooling (T11).** `lib/db/index.ts` calls `postgres(url)` with defaults. On
  Vercel + Supabase's Supavisor *transaction* pooler this must become
  `postgres(url, { max: 1, prepare: false })` — transaction pooling does not support
  prepared statements. Harmless locally; a production footgun.
