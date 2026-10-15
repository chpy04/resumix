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

An **application** is what the app is now organised around: one row per job,
carrying a status, two resume references — the live resume being tailored,
and the immutable PDF snapshot pinned to it (D-032) — and a cover letter.
Logging one clones a resume named after the company, so there is always
something to tailor; adding a cover letter copies the default letter the same
way. Everything else about it is freeform text and untyped attachments. Marking it
applied — or dragging it onto the Applied zone — moves it off the board into
the Applied table, where most applications quietly stay (D-033).

Rendering is: load the selections → substitute them into the template's
`<<TOKEN>>` placeholders → POST the `.tex` to a TeX Live sidecar → get a real
`pdflatex` PDF back. Saving a PDF snapshots the bytes into `resume_pdf`, and
that snapshot is what the download button serves — so editing content or a
template later never retroactively changes an already-saved resume.

A **cover letter** is the counter-example to all of that, and the asymmetry
is the point (D-035). It has no reuse — one letter, one company — so it
stores its own text: its LaTeX in `content` and, when it has one, its prose
in a plain-text `body`, escaped into the one `%%BODY%%` line of that LaTeX
(D-046). No template, no selections, no tokens, and no PDF snapshot, because
nothing but editing that letter can change it. Creating one copies the
default verbatim; downloading one compiles the stored text on demand.

Content is substituted **verbatim and unescaped**: bullets legitimately
contain `\textbf{}`, `\href{}{}`, `\$` and `\&`, because the user is authoring
LaTeX (D-008). The one thing escaped is a cover letter's `body`, which was
never LaTeX (D-046). Content is never deleted, only archived (D-011).

## The pieces

- **Web app** — Next.js 15 / React 19 / TypeScript / Tailwind v4, App Router.
  The home page is the applications board: a **Pipeline** tab holding the
  statuses that still want something (draft, proposing, needs review, ready,
  interviewing, offered) as a drag-and-drop kanban, and an **Applied** tab
  holding everything that has left it — applied or rejected — as a
  searchable table. Proposing, Needs review and Ready are the agent review
  flow's columns: a card can be dragged out of them but never into them,
  because only the flow sets those statuses, and Needs review is sorted by
  the agent's fit score (D-041). Picking a card up reveals two drop zones
  under the columns, `applied` and `rejected`, which are the only way those
  statuses appear on the board (D-034). `/applications/[id]` is one
  application — fields, freeform notes, attachments, the linked resume, the
  button that marks it applied and, when the agent supplied them, its
  summary and the job description, read-only.
  `/applications/[id]/review` is where an application the agent submitted
  is reviewed, and Needs review and Ready cards open it: a stepper over the
  resume editor in review mode (the agent's picks badged, with Reset to
  agent pick, and its bullet suggestions inline: an edit on its bullet in
  yellow, an addition in green, both already in the preview, each applied
  or rejected by Chris before the resume can be approved, D-045), the cover
  letter's plain text beside its PDF when there is one, the form's questions
  when the agent recorded any, and a final
  Approve. Questions are approved one by one, profile answers in bulk; an
  open-ended answer can be sent back to the agent for a redraft, and an EEO
  question is answered only by Chris (D-047). An answer ticked "remember this
  answer" is saved for the agent to reuse on later forms, where it arrives
  already approved and shows as one green line (D-048). Each section and each question
  is approved on its own, and editing it afterwards unapproves it and sends a
  Ready application back to Needs review; library and template edits do not. Final approval pins the resume snapshot, stores
  the letter's PDF as an attachment, makes the application Ready and copies
  `/resumix-apply <id>` (D-044).
  `/resumes` is the resume library (fuzzy search, per-card download of the
  saved snapshot), `/cover-letters` is its counterpart for letters, and
  `/cover-letter/[id]` is a two-pane editor with the same live preview the
  resume editor uses: a letter with a `%%BODY%%` line has Body (plain text)
  and LaTeX tabs on the left, and one written entirely in LaTeX has only
  the LaTeX textarea. `/resume/[id]` is the
  two-pane editor: content
  selection with `@dnd-kit` reordering and per-slice autosave on the left, a
  live PDF preview and a LaTeX template tab on the right.
  `/resume/[id]?application=<id>` is the same editor in **application mode**,
  where back returns to the application and saving writes the PDF to it,
  except on a Ready application, whose PDF is the one approved (D-044).
- **Database** — Postgres, 23 tables, Drizzle for typed queries and
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
  with a 503. A **Create a plan first** switch, off by default, adds the
  `plan-first` label, so the agent drafts its plan on the Excalidraw board
  and waits for approval instead of building straight to a PR (D-036).
- **Agent endpoint** — `POST /api/mcp`, the Model Context Protocol over
  streamable HTTP, hand-rolled and stateless: one JSON-RPC message per
  request, no sessions, no SSE, no SDK (D-040). `lib/mcp/` is a pure
  dispatcher plus a registry of zod-typed tools, one module each in
  `lib/mcp/tools/`, listed in `docs/API.md`'s tool reference. A failing tool
  answers with text telling the agent what to do next, never a protocol
  error. It takes only an API token (below). `submit_for_review` moves an
  application from Proposing to Needs review, and refuses while its resume
  or its letter runs past one page. Ready applications are applied to from
  `agent/` with `/resumix-apply`: the agent fetches the approved packet
  (`get_apply_packet`), downloads the approved PDFs from `/api/mcp/files/…`
  with the same token, fills the form in a visible browser and stops before
  Submit. Chris submits; `mark_applied` then moves the application to
  Applied, and a field nobody saw (`report_question`) sends it back to
  Needs review (D-050). `npm run mcp:smoke` drives it over real HTTP, and
  the gate runs that from the e2e suite.

## Users and isolation

Every query is scoped to a user. `user_id` sits on the nine root tables
(`template`, `experience`, `project`, `technical_skill_row`, `resume`,
`cover_letter`, `application`, `api_token`, `saved_answer`); every other table inherits its owner through a join to its
parent (D-018). Every
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

`/api/mcp/**` is outside all three: it takes only an `rmx_` API token in
`Authorization: Bearer`, in every mode including `dev`, minted and revoked
from the command line (`npm run token:create`, `token:revoke`) and stored as
a sha-256 hash (D-039).

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

- **Production is one cloud VM, deployed by hand.** `docker compose` from
  `~/.resumix/src` on the VM, entirely separate from development, behind an
  HTTPS front end that is not part of this repo (D-051,
  `docs/DEPLOYMENT.md`). `npm run deploy:prod` deploys only the earlier
  laptop instance (D-031) and does not run on Linux. The Vercel + Fly.io +
  Supabase path is documented as an appendix and has never been executed.
- **No redundancy.** One VM and one disk, with the backups on it.
- **No multi-template UI.** The schema supports many templates per user; the
  editor assumes the resume's own.
- **Nothing shows which user is signed in.** Invisible with one seeded user.
- **PDFs are `bytea`.** `lib/storage.ts` is the swap point if that outgrows
  the database (D-003).

## Ports

Two disjoint blocks, so development and a production instance can run on one
machine at once and neither can be reached by accident from the other's
tooling. On the VM, production's block is all there is.

|             | web             | postgres                                 | latex     |
| ----------- | --------------- | ---------------------------------------- | --------- |
| development | 3000 (e2e 3100) | **5433** — 5432 is usually already taken | 8080      |
| production  | **39000**       | **39432**                                | **39080** |

Production's block is deliberately odd and bound to `127.0.0.1`; on the VM,
only the HTTPS front end reaches 39000. Nothing in development points at
production; nothing may (`docs/DEPLOYMENT.md`, "Agents do not deploy").
