# Project state

_Last updated: 2026-09-19 — **feature-complete and multi-user**. All twelve tasks
merged, plus the empty-section fix (D-016) and T14 (multi-user, awaiting merge)._

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

- **T6 API** — all 19 route handlers, `lib/queries/**`, `lib/storage.ts`, zod validation.
  Verified live over HTTP end to end: 401 without a token; creating a resume clones the
  Default's template and all six selection slices (3 exp / 14 bullets / 3 proj / 6 bullets /
  5 rows / 39 skills); render → `ok, pages:1`; `POST /pdf` → `Chris_Pyle_Acme_Rocket_Labs_Resume.pdf`
  from the input `acme ROCKET labs`; `GET /pdf` serves the snapshot with the right headers.
  **Anti-drift verified**: after editing a bullet, a fresh render changes but the saved
  snapshot's bytes are identical (same md5). **Archive semantics verified**: an archived
  bullet disappears from the default library listing, reappears with `?includeArchived=1`,
  stays selected on the resume, and still renders.
- **D-014** — the DB client had to become lazy: `next build` evaluates route modules, so an
  eager `postgres(DATABASE_URL)` broke the build on any machine without a database.

**Current test count: 71 passing.** `npm run build` green with all 19 API routes.

- **T8 editor** — two-pane editor, dnd-kit reordering, per-slice autosave, archived-unless-
  selected visibility, inline global content editing. Pure reducer/visibility/autosave logic
  is unit-tested.
- **T9 preview** — debounced coalescing live preview via `POST /render` that keeps the last
  good PDF visible through compile errors, a page-count badge, and a dependency-free LaTeX
  editor with a click-to-insert token legend. react-pdf is client-only with a local worker.
- **T10 e2e** — 15 Playwright tests, one per behavioural promise in `spec.md`. No spec
  violations found.
- **T11 deployment** — `README.md` (executed from a clean clone), `docs/DEPLOYMENT.md`,
  `CLAUDE.md`, `docs/CONTRIBUTING.md`, `services/latex/fly.toml`.
- **D-015** — the latex sidecar now requires a bearer token on `/compile`; it needs a public
  IP on Fly (a Vercel function cannot join Fly's 6PN mesh) and LaTeX can read files on its box.
- **T12 review** — `docs/REVIEW.md`. One low-severity fix (header sanitization); no critical
  or high findings in the areas examined.

## T14 — multi-user (branch `feat/t14-multi-user`)

The database is no longer single-tenant. A `users` table owns everything:
`user_id` sits on the five root tables (`template`, `experience`, `project`,
`technical_skill_row`, `resume`) and every other table inherits its owner
through its parent (D-017). Every query function takes a `userId` and filters
on it; another user's id reads as "not found", never "forbidden".
`lib/queries/isolation.test.ts` states that guarantee as 13 tests.

Authentication is now three modes behind one `requireUserId()` (D-018):

- **`dev`** (default locally) — no login screen at all; the session is the
  first user in `users`, which is the single user `npm run db:seed` creates.
- **`password`** (default in production) — the original shared-password gate,
  except the token now names a user (D-019).
- **`supabase`** — the intended end state, **not implemented**. The seam is
  `lib/auth-supabase.ts` and it fails closed. Everything downstream of "who is
  this?" is already written against a `users` row, so implementing it is a
  one-file change.

Migration `0003` backfills: an existing single-tenant database gets an
`owner@localhost` user who adopts every row. Verified on both a fresh
database and a simulated pre-T14 one.

Still true: the V1 resume round-trips byte-for-byte (`npm run smoke`), now
read back through a user-scoped query. See `docs/agents/t14.md`.

## Status: feature-complete

**143 unit tests + 16 browser tests passing. Build green. Smoke test green.**
(110 + 33 new for T14.)

Post-completion fix (2026-09-19): deselecting every item in a section aborted the
compile — the template's `\begin{itemize}` was left with no `\item`. Templates now
support `<<IF:TOKEN>> ... <<ENDIF>>` and every default section is wrapped in one, so an
empty section disappears heading and all. Migration `0002` wraps existing templates
section-by-section, preserving hand edits elsewhere in them. See D-016.
Everything in `spec.md` is implemented and verified. The app has not been deployed —
`docs/DEPLOYMENT.md` is written but unexecuted (no cloud credentials in this environment).

Sensible next steps, none blocking: deploy per `docs/DEPLOYMENT.md`; exercise the
`pages > 1` warning against real two-page content; consider the partial-nested-map trap in
`docs/REVIEW.md` if a second API client is ever written.

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
- **Supabase OAuth is stubbed, not built** (T14). `lib/auth-supabase.ts` is the
  only file that needs writing; it fails closed until then.
- No UI shows which user you are signed in as — invisible with one seeded
  user, worth adding when OAuth lands.
- Deleting a user is deliberately not possible (`on delete restrict`).
- PDF storage is `bytea`; swap point is `lib/storage.ts` if it ever outgrows that.
- **Serverless pooling (T11).** `lib/db/index.ts` calls `postgres(url)` with defaults. On
  Vercel + Supabase's Supavisor *transaction* pooler this must become
  `postgres(url, { max: 1, prepare: false })` — transaction pooling does not support
  prepared statements. Harmless locally; a production footgun.
