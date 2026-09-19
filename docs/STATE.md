# Project state

What exists right now. This file describes the system as it stands — it is not
a changelog and not a plan. What is being _worked on_ lives on the GitHub
issue and its `status:*` label; what was _decided_ and why lives in
`docs/DECISIONS.md`; what changed
and when lives in the git log.

**Read this first** when picking the project up cold, then
`docs/ARCHITECTURE.md`, then the contracts (`SCHEMA.md`, `API.md`,
`TEMPLATE_TOKENS.md`).

## The idea

A resume stores no text. It stores _which_ content ids it selected and in what
order — bridge tables with composite primary keys and a dense `sort_order`
(D-007). Content (experiences, projects, bullets, skill rows, skills) exists
once, globally. Editing a bullet is therefore a global edit that instantly
changes every resume that selected it. That is intentional, and it is the
source of most reports that turn out not to be bugs.

Rendering is: load the selections → substitute them into the template's
`<<TOKEN>>` placeholders → POST the `.tex` to a TeX Live sidecar → get a real
`pdflatex` PDF back. Saving a PDF snapshots the bytes into `resume_pdf`, and
that snapshot is what the download button serves — so editing content or a
template later never retroactively changes an already-saved resume.

Content is substituted **verbatim and unescaped**: bullets legitimately
contain `\textbf{}`, `\href{}{}`, `\$` and `\&`, because the user is authoring
LaTeX (D-008). Content is never deleted, only archived (D-011).

## The pieces

- **Web app** — Next.js 15 / React 19 / TypeScript / Tailwind v4, App Router.
  Home page is a resume grid with fuzzy search and per-card download of the
  saved snapshot. `/resume/[id]` is a two-pane editor: content selection with
  `@dnd-kit` reordering and per-slice autosave on the left, a live PDF preview
  and a LaTeX template tab on the right.
- **Database** — Postgres, 15 tables, Drizzle for typed queries and
  hand-written SQL migrations in `drizzle/`. `scripts/migrate.ts` is
  idempotent. The client is lazy: `lib/db/index.ts` exports Proxies that open
  the pool on first query, because `next build` evaluates every route module
  and an eager `postgres(DATABASE_URL)` fails the build on any machine without
  a database (D-014).
- **LaTeX sidecar** — `services/latex/`, a Debian + TeX Live image running a
  zero-dependency `node:http` server, non-root, `-no-shell-escape`, 20s
  timeout, bounded concurrency. `/compile` requires a bearer token; `/health`
  is open (D-015).
- **Render engine** — `lib/render/`, pure functions with no framework.
  `<<TOKEN>>` substitution plus `<<IF:TOKEN>> … <<ENDIF>>` blocks, which every
  section of the default template is wrapped in: an empty section would
  otherwise leave `\begin{itemize}` with no `\item`, a fatal LaTeX error
  (D-016).
- **PDF preview** — `react-pdf`, client-only via `next/dynamic({ ssr: false })`,
  with a hand-copied local pdf.js worker (`public/pdf.worker.min.mjs`) so it
  cannot version-skew against the bundled `pdfjs-dist`.
- **Feedback widget** — a floating button on every gated page opens a
  non-modal popover anchored to it, so the page being reported stays visible
  and clickable (D-023). The button is itself a screenshot dropzone. The
  filed issue carries the route on its **Page** line, with the origin and a
  readable browser name in the Environment block (D-024), so two reports
  about the same page group together whichever deployment they came from.
  Filed via `POST /api/feedback`. Screenshots are committed to the orphan
  `feedback-assets` branch and linked at their commit sha (D-021). Needs
  `GITHUB_TOKEN` and `GITHUB_REPO`; without them the endpoint fails closed
  with a 503.

## Users and isolation

Every query is scoped to a user. `user_id` sits on the five root tables
(`template`, `experience`, `project`, `technical_skill_row`, `resume`); every
other table inherits its owner through a join to its parent (D-018). Every
query function takes a `userId` and filters on it, and another user's id reads
as "not found", never "forbidden". Isolation is enforced in the query layer,
not in `middleware.ts` — middleware runs on the Edge and cannot reach the
database. `lib/queries/isolation.test.ts` is the executable statement of that
guarantee.

Authentication is three modes behind one `requireUserId()`, selected by
`RESUMIX_AUTH_MODE` (D-019):

- **`dev`** — the default outside production. No login screen; the session is
  the first user in `users`, which is whoever `npm run db:seed` created.
- **`password`** — the default in production. A shared password exchanged for
  a Web Crypto HMAC token that names its user in a `sub` claim (D-020).
  Edge-safe: nothing in the `middleware.ts` import graph may touch
  `node:crypto`.
- **`supabase`** — a written seam that is **not implemented**.
  `lib/auth-supabase.ts` fails closed. Everything downstream of "who is this?"
  already works against a `users` row.

## Verification

`npm run smoke` is the acceptance bar: it reads the seeded V1 resume back
**out of the database** through a user-scoped query, renders it, diffs it
against `docs/reference/v1-resume.tex`, and compiles it through the real latex
sidecar. The project's governing constraint — "I should always be able to
represent my current resume" — is that diff coming back empty.

The merge gate is `npm run verify`: `format:check`, `lint`, `typecheck`,
`test`, `build`, reseed, `smoke`, `test:e2e`, in an order that works. It needs
`docker compose up -d db latex`. `test` needs `DATABASE_URL` or the
`lib/queries` integration suites self-skip and still report green, so the
skipped count must be zero. `build` is not redundant with `typecheck`:
`next build` additionally validates App Router export signatures, and a page
whose default export takes a custom prop typechecks fine and fails the build.

CI runs the same gate as seven parallel workflows under `.github/workflows/`,
one per failure class, sharing composite actions for setup. `status.yml` is
the exception — it keeps an issue's `status:*` label in step with git rather
than running any gate, and needs no secret to do it.

Standards are enforced mechanically, not by prose: Prettier over the tree, and
an ESLint flat config whose `no-restricted-*` rules turn the invariants into
build failures — `components/**` and `app/**` cannot import `lib/db`, the Edge
graph cannot import `node:crypto`, and each tree's import style is fixed. Every
rule message names the file in `.claude/rules/` that explains it (D-017).

## Deliberate limits

These are properties of the system as it stands, not a to-do list.

- **Not deployed.** `docs/DEPLOYMENT.md` describes the Vercel + Fly.io +
  Supabase path; it has not been executed.
- **`lib/db/index.ts` calls `postgres(url)` with defaults.** On Supabase's
  Supavisor _transaction_ pooler this must become
  `postgres(url, { max: 1, prepare: false })` — transaction pooling does not
  support prepared statements. Harmless locally; a production footgun.
- **No multi-template UI.** The schema supports many templates per user; the
  editor assumes the resume's own.
- **Nothing shows which user is signed in.** Invisible with one seeded user.
- **PDFs are `bytea`.** `lib/storage.ts` is the swap point if that outgrows
  the database (D-003).

## Ports

Web 3000 (e2e uses 3100), latex 8080, postgres **5433** — 5432 is usually
already taken.
