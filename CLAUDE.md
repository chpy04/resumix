# CLAUDE.md

Deliberately thin. It carries what must be in context for _every_ change;
everything directory-specific lives in `.claude/rules/`, which loads only
when you touch matching files. Read `docs/STATE.md` first, then
`docs/ARCHITECTURE.md`. Both describe what exists; what is being _worked on_
is not in `docs/` at all.

## What this is

Content (experiences, projects, bullets, skills) is stored **once,
globally**. A **Resume** is a named selection + ordering of that content
(bridge tables, composite PKs, `sort_order`), bound to a **Template** (raw
LaTeX with `<<TOKEN>>` placeholders). Rendering = load selections →
substitute into the template → POST the `.tex` to a sidecar TeX Live
container → get a real `pdflatex` PDF back. Saved PDFs are snapshotted into
`resume_pdf`, so a resume's downloaded bytes never silently change when
content or templates are edited later.

An **Application** is one job applied to, and the thing the app is organised
around — the home page is the applications board, the resume library sits
behind it at `/resumes`. An application carries a company, a status
(`draft`, the agent flow's `proposing`/`needs_review`/`ready` (D-041), or
`applied`/`interviewing`/`offered`/`rejected`), freeform notes,
untyped attachments, two resume references — the live `resume_id` you tailor,
and the `resume_pdf_id` snapshot pinned when you save that resume to the
application — and a `cover_letter_id`. Logging one clones a resume named
after the company; adding a cover letter copies the default letter the same
way. No company, event, task or contact tables (D-032).
`applied` is not a board column — it is a searchable table behind its own tab,
because most applications are sent and never touched again (D-033).

A **Cover letter** is the deliberate inversion of all that, and the fastest
way to get this wrong is to make it symmetrical. It has no reuse, so it
stores its own text: `content` is the letter's LaTeX, and an optional
plain-text `body`, which the agent drafts and the review edits, is escaped
and placed at its one `%%BODY%%` line (D-046). No template, no selections,
no tokens, no snapshot table. Creating one copies both columns
**verbatim**; downloading one compiles the stored text on demand. Which is
also why `GET /api/cover-letters/:id/pdf` is the single endpoint in this app
where a LaTeX error is an HTTP error — there is no JSON envelope on a binary
download (D-035).

The consequence worth internalising: **a resume stores no text.** Editing a
bullet is a global edit that instantly changes every resume that picked it.
That is intentional, and most "bugs" that turn out not to be bugs are this.

## Five invariants

Breaking any of these is silent — nothing fails loudly at the moment you do it.

1. **Archive, never delete.** No DELETE endpoints on content. `is_archived`
   hides it from pickers; resumes that already selected it keep rendering it
   forever (D-011).
2. **Content is raw, unescaped LaTeX.** Bullets legitimately contain
   `\textbf{}`, `\href{}{}`, `\$`, `\&`. Never add auto-escaping — it would
   corrupt every existing bullet (D-008). Plain text arriving from outside
   LaTeX (a letter's `body`) is escaped by `lib/render/escape.ts`; library
   content never is (D-046).
3. **The DB client stays lazy.** Never hoist `postgres(...)`/`drizzle(...)`
   to module scope; `next build` evaluates every route module and would fail
   on any machine without a live `DATABASE_URL` (D-014).
4. **Nothing in the `middleware.ts` import graph may touch `node:crypto`.**
   Middleware runs on the Edge runtime. `lib/auth.ts` is Web Crypto only.
5. **Every query is scoped to a user.** Handlers begin with
   `const userId = await requireUserId(request)` (`lib/session.ts`) and pass
   it down; the query layer filters on it. `/api/mcp/**` handlers begin with
   `requireMcpUserId(request)` instead, which takes only an `rmx_` API token,
   in every auth mode (D-039). `user_id` lives only on the nine
   root tables (`template`, `experience`, `project`, `technical_skill_row`,
   `resume`, `cover_letter`, `application`, `api_token`, `saved_answer`) —
   bullets, skills, bridge rows, PDF snapshots, application files, application
   questions and bullet suggestions inherit their owner through a join to
   their parent. Isolation is enforced in the
   queries, **not** in `middleware.ts`, which runs on the Edge and cannot
   reach the database. Another user's id must read as "not found", never
   "forbidden". `lib/queries/isolation.test.ts` is the executable form of
   this paragraph and the first thing to run after touching any query.

## Auth modes

`RESUMIX_AUTH_MODE` = `dev` | `password` | `supabase`, defaulting to `dev`
outside production and `password` in production (`lib/auth-mode.ts`). `dev`
means **no login screen**: the session is the first user in `users`, which is
whoever `npm run db:seed` created. `supabase` is a written-but-unimplemented
seam (`lib/auth-supabase.ts`) that fails closed. The browser suite pins
`RESUMIX_AUTH_MODE=password` so it drives the real login screen; dev and
supabase modes are covered in-process by `lib/session.test.ts`.

## Merge gate

```
npm run verify
```

That is `format:check`, `lint`, `typecheck`, `test`, `build`, reseed,
`smoke`, `test:e2e` — in an order that works. Requires
`docker compose up -d db latex`.

Run the whole thing, not a subset. Each step catches something the previous
one cannot:

- `typecheck` is **not** enough on its own. `next build` additionally
  validates App Router export signatures and resolves the webpack config; a
  page default export taking a custom prop typechecks fine and fails the
  build. That bug reached `main` once.
- `test` needs `DATABASE_URL` or 273 integration tests silently self-skip and
  still report green. Expect **702 passing, 0 skipped**.
- `smoke` reads live DB state and a prior Playwright run leaves edited
  content behind — hence the reseed before it.

## Directory rules

`.claude/rules/` holds the conventions for each part of the tree, loaded
when you edit matching files. ESLint enforces the mechanical half and its
error messages name the rule file.

| rule              | applies to                                   |
| ----------------- | -------------------------------------------- |
| `imports.md`      | all TS/TSX — two import regimes, by runtime  |
| `api-routes.md`   | `app/api/**`                                 |
| `data-access.md`  | `lib/queries/**`, `lib/db/**`, `drizzle/**`  |
| `components.md`   | `components/**`, `app/**/*.tsx`              |
| `styling.md`      | the same, plus `app/globals.css`             |
| `render-latex.md` | `lib/render/**`, `lib/latex.ts`, `services/` |
| `auth.md`         | the auth + middleware graph                  |
| `mcp.md`          | `lib/mcp/**`, `app/api/mcp/**`               |
| `agent-skills.md` | `agent/**`                                   |
| `testing.md`      | `**/*.test.ts`, `e2e/**`, `scripts/**`       |
| `docs.md`         | `docs/**`                                    |
| `github.md`       | `.github/**`, `scripts/status.sh`            |

## Contracts

`docs/SCHEMA.md`, `docs/API.md`, `docs/TEMPLATE_TOKENS.md` are authoritative.
Code must match them; a disagreement is a bug in one of them to be fixed
deliberately, not papered over. Update the contract in the same commit as
the code.

## How to work here

- **Follow the existing pattern before inventing one.** Most of this
  codebase does the same thing the same way in seven places; find one and
  copy it. Where it doesn't, that inconsistency is the bug.
- **Comments explain why.** The code says what. Every non-obvious decision
  in this repo already carries a comment naming its reason or its D-number —
  match that density, and add a D-entry to `docs/DECISIONS.md` for anything a
  future reader would want to reverse.
- **Prefer deleting.** Dead code here has a habit of looking load-bearing;
  30 unused type aliases survived four waves. If nothing imports it, remove it.
- **Keep logic pure and testable.** The valuable modules in this repo
  (`lib/render`, `lib/editor`) are pure functions with exhaustive unit tests
  and no framework. Reach for that shape before reaching for a hook.
- **Don't add a dependency** to solve something the platform does. There is
  no test framework, no assertion library, no state manager, and the LaTeX
  sidecar has zero runtime deps. That is deliberate.
- **`docs/` describes the present tense.** It says what exists, never what
  is planned or in flight. A change updates `docs/STATE.md` only where it
  changed what is true, not to record that it happened — git is the record
  of that.

## Two ways to work here

**In a session with a human.** The default, and almost certainly you. Work
the way you normally would: understand the request, branch, build it, get
`npm run verify` green, commit. Approval happens in conversation — "go
ahead" is the whole gate.

There is no ceremony to perform. No issue to file, no label to move, no plan
to post and wait on. If a GitHub issue already exists and the human named
it, reference it in the commit body; if one does not, **do not create one** —
the issue list is the human's inbox, and an agent that files its own work
item has quietly promoted its own idea to a commitment nobody made. Say it
in your reply instead.

**Unattended, through `/implement`.** `.claude/skills/implement` takes one
GitHub issue from backlog to an open PR with nobody watching.
`scripts/herd.sh` starts one agent per `status:backlog` issue. That agent is
an orchestrator: it hands planning, building and verification to the
`planner`, `implementer` and `verifier` subagents in `.claude/agents/`, and
loops build → verify until it passes. The PR is the only human checkpoint
(D-036), unless the issue is labelled `plan-first`; then the agent stops
after drawing its plan on the Excalidraw board and builds once a human moves
the issue back to backlog.

**That is not this.** Those rules live in the skill, the agent files and
`.claude/rules/github.md`, deliberately out of here, so an attended session
never pays for them in context. The skill is `disable-model-invocation: true`
and fires only when something types `/implement 12`, never on its own.

## Production is not yours

There is a second Resumix on this machine. It runs from its own clone at
`~/.resumix/src`, its own Postgres volume, its own images, on ports
**39000 / 39432 / 39080**, and it holds Chris's real resume content — not
seed data. `npm run deploy:prod` is the only thing that touches it, and a
human is the only one who runs it (D-031, `docs/DEPLOYMENT.md`).

**Never deploy, migrate, seed, query, stop or read it.** Everything you do
— `npm run dev`, `npm run verify`, Playwright, `psql` — belongs to the
development environment on **3000 / 3100 / 5433 / 8080**, whose database
exists to be wiped and reseeded and where `npm run verify` reseeds with
`--force` on every run. That is exactly why the two are separate: so the
merge gate can destroy its data freely.

This is enforced, not merely asked. `scripts/deploy-prod.sh` aborts when
`CLAUDECODE` is set, and `.claude/settings.json` denies the deploy script,
the prod compose file, and everything under `~/.resumix/`. If you find
yourself wanting to route around either, the answer is no — say what you
wanted to do and let the human do it.

Editing the prod _lane_ is normal work: `Dockerfile`,
`docker-compose.prod.yml`, `scripts/deploy-prod.sh` and `prod.env.example`
are ordinary checked-in files. Changing them is fine. Running them is not.

`agent/` is the same kind of lane. It belongs to a second Claude, the one
that applies to jobs through production's MCP (D-038). Edit its files when a
change asks for it, but never run anything there (no `claude`, no
`agent/claude.sh`) and never read `agent/.env`. The Resumix MCP is configured
in `agent/.mcp.json` and nowhere else: `lib/agent-workspace.test.ts` fails if
a root `.mcp.json` or `.claude/settings*.json` names it. It cannot see
`claude mcp add`, which writes to `~/.claude.json`, so never use that for
Resumix.

## Branches and worktrees

**Never commit to `main`.** Branch `feat/<slug>`, `fix/<slug>` or
`chore/<slug>`.

Several agents share this checkout and "nobody else is touching this" is
never safe to assume. Two `next dev`/`next build` processes in one checkout
corrupt `.next` — it surfaces as `ENOENT .next/routes-manifest.json` or
`PageNotFoundError: Cannot find module for page: /api/...` and random e2e
failures, and it is never a real regression (`rm -rf .next` and re-run). So
if another agent is live, take a worktree:

```bash
git worktree add ../resumix-wt/<slug> -b <type>/<slug> origin/main
ln -s /Users/chrispyle/resumix/node_modules ../resumix-wt/<slug>/node_modules
ln -sfn /Users/chrispyle/resumix/.env ../resumix-wt/<slug>/.env
```

Worktrees live at `../resumix-wt/`, outside the repo and never committed.
`node_modules` and `.env` are symlinked in — don't run `npm install` in a
worktree unless you mean to replace that symlink.
