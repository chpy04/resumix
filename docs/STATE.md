# Project state

_Last updated: 2026-09-19 — **feature-complete and multi-user**. All twelve tasks
merged, plus the empty-section fix (D-016), a standards pass (D-017) and T14._

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

- **T13 feedback widget** — a floating "Give feedback" button on every gated page
  opens a form (bug / feature request, description, drag-drop-or-paste screenshot,
  auto-captured page URL) that files a **GitHub issue** via `POST /api/feedback`.
  The form became a corner popover and the button became a dropzone afterwards —
  see "Feedback widget: popover + drop-on-button" below.
  Screenshots are committed to the orphan `feedback-assets` branch and linked at
  their commit sha. This is the push half of the feedback loop; the pull half (an
  agent that works issues off GitHub) lives outside this repo. Needs `GITHUB_TOKEN`
  and `GITHUB_REPO` set — without them the endpoint fails closed with a 503.

## T14 — multi-user

The database is no longer single-tenant. A `users` table owns everything:
`user_id` sits on the five root tables (`template`, `experience`, `project`,
`technical_skill_row`, `resume`) and every other table inherits its owner
through its parent (D-018). Every query function takes a `userId` and filters
on it; another user's id reads as "not found", never "forbidden".
`lib/queries/isolation.test.ts` states that guarantee as 13 tests.

Authentication is now three modes behind one `requireUserId()` (D-019):

- **`dev`** (default locally) — no login screen at all; the session is the
  first user in `users`, which is the single user `npm run db:seed` creates.
- **`password`** (default in production) — the original shared-password gate,
  except the token now names a user (D-020).
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

## Standards pass (2026-09-19)

A cleanup wave with no behaviour change, aimed at keeping agentic
contributions from accumulating drift. See D-017.

- **Tooling.** Prettier over the whole tree (`docs/agents/**` excluded as an
  append-only archive) and a small ESLint flat config whose `no-restricted-*`
  rules turn the project's invariants into build failures: `components/**`
  and `app/**` cannot import `lib/db`, the Edge-runtime graph cannot import
  `node:crypto`, and each tree's import style is enforced. Every rule message
  names the file in `.claude/rules/` that explains it. `npm run lint` used to
  be a broken interactive `next lint` stub.
- **`npm test` was under-reporting.** It did not load `.env`, so the 16
  `lib/queries` integration suites self-skipped and the gate passed on 94 of
  110 tests. It now reads `.env`; expect 110 passing, 0 skipped.
- **`npm run verify`** runs the whole gate in a working order — notably a
  reseed before `smoke`, because a Playwright run leaves edited content in
  the database and the round-trip diff then fails spuriously.
- **CI.** Seven parallel workflows under `.github/workflows/` (format, lint,
  typecheck, build, test, smoke, e2e) run on every push and PR, so each
  failure class reports separately and as early as it can. Shared setup is in
  composite actions; the TeX Live image is layer-cached across runs.
- **Contract drift fixed.** Three query modules were spreading raw DB rows
  into responses typed as the wire shape, shipping `created_at`/`updated_at`
  past `docs/API.md`; they now map through `toWire()` like the other four.
  `docs/API.md` gained the `templateId` field it was missing and the real
  `POST /pdf` response shape.
- **Consistency.** `POST /api/auth` joined the `withApiErrors` + zod
  pipeline; `RouteContext` moved to `lib/http.ts` from 11 duplicate
  declarations; `LoginForm`'s bare `fetch` moved into `lib/api-client.ts`, so
  "components never call fetch" is now true and lint-enforced; 230
  `[var(--color-x)]` arbitrary values became the Tailwind v4 utilities the
  theme already generates, and the ad-hoc red/green shades across nine files
  became `danger`/`success` tokens.
- **Dead code removed**: 30 unused `*Record` type aliases, two unused query
  exports, an unused generic parameter, a duplicate tsconfig key, three stale
  `eslint-disable` directives.
- **Agent config.** `CLAUDE.md` is now the always-loaded half only (what the
  app is, four silent invariants, the gate); the per-directory conventions
  live in `.claude/rules/*.md`, each scoped by a `paths` glob so it loads
  only when the matching files are touched.

Known, left alone deliberately: four `react-hooks/exhaustive-deps` warnings
(two `autosave` deps in `ResumeEditor`, two in `ResumeGrid`). They are real
observations, but fixing them changes editor behaviour and belongs in its
own change with e2e coverage, not in a formatting pass.

## Feedback widget: popover, drop-on-button, better issue body (2026-09-19)

Three changes to T13's widget. The first two are UI only; the third changes the
shape of the issue body, not the endpoint's wire contract. See D-022 and D-023.

- **The form is a popover, not a modal.** It opens above the button in the
  bottom-right corner instead of a centred panel over a dimmed backdrop. A bug
  report is a description of what is on screen, and the backdrop was covering
  the evidence. Dismissal is now the popover contract: Escape, Cancel, or a
  click anywhere else on the site. The outside-click listener lives in
  `FeedbackWidget` rather than the panel, because the button has to be
  excluded from "outside" too — otherwise clicking it would close and
  immediately reopen, wiping a half-written report. Clicking the button while
  the form is open therefore toggles it shut.
- **The button is the dropzone.** Dragging an image file onto "Give feedback"
  opens the form with it already attached; dropping a second one swaps the
  image without remounting the form, so typed text survives. While a file is
  being dragged anywhere over the page the button says "Drop screenshot" (its
  `aria-label` stays fixed, so the e2e suite and screen readers keep one name
  for it), and a drop that misses is swallowed — otherwise the browser
  navigates to the raw image and the user loses the page they were reporting.
- The screenshot now lives in `FeedbackWidget`, since it can arrive while the
  panel is closed; the panel keeps kind/description and stays presentational.
- `lib/feedback/drag.ts` holds the two decisions worth testing without a
  browser: a drag exposes `types` but not `files` until the drop (so
  "is this a file drag" can only read `types`), and a multi-file drop takes
  the first _image_, not the first file. 5 unit tests.
- Three new e2e tests in `e2e/feedback.spec.ts` (drop-on-button attaches and
  opens; a second drop preserves typed text; the popover dismisses on an
  outside click and toggles on the button). Native file drags have no
  Playwright API, so they build a real `DataTransfer` in the page.
- **The issue body separates route from host.** `**Page:**` is now the route
  alone (`/resume/abc?tab=template`), and the origin moved into the
  Environment block beside a new `Browser:` line — so two reports about the
  same page group together whether they came from prod or a laptop, and which
  one it was is still recorded. `lib/feedback/user-agent.ts` turns the UA
  string into `Chrome 142 on macOS`; the raw string stays underneath it,
  because a hand-rolled parser is the right size for one caller only if
  getting it wrong costs nothing. 4 unit tests there, plus the reworked body
  tests in `issue.test.ts`.
- While in there: these two components were the last 51 `[var(--color-x)]`
  arbitrary values in the tree, missed by the standards pass because T13 was
  developed on a parallel branch. They now use the generated utilities, and
  the one raw `text-amber-400` became a `--color-warning` token.

## What is in flight

See `docs/WORKPLAN.md` for the live task board. Per-task briefs and completion
reports live in `docs/agents/<task-id>.md`.

## How the pieces fit

A resume never stores text. It stores _which_ content ids it picked and in what
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
- PDF storage is `bytea`; swap point is `lib/storage.ts` if it ever outgrows that.
- **Serverless pooling (T11).** `lib/db/index.ts` calls `postgres(url)` with defaults. On
  Vercel + Supabase's Supavisor _transaction_ pooler this must become
  `postgres(url, { max: 1, prepare: false })` — transaction pooling does not support
  prepared statements. Harmless locally; a production footgun.
