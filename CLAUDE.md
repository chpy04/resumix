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
   corrupt every existing bullet (D-008).
3. **The DB client stays lazy.** Never hoist `postgres(...)`/`drizzle(...)`
   to module scope; `next build` evaluates every route module and would fail
   on any machine without a live `DATABASE_URL` (D-014).
4. **Nothing in the `middleware.ts` import graph may touch `node:crypto`.**
   Middleware runs on the Edge runtime. `lib/auth.ts` is Web Crypto only.
5. **Every query is scoped to a user.** Handlers begin with
   `const userId = await requireUserId(request)` (`lib/session.ts`) and pass
   it down; the query layer filters on it. `user_id` lives only on the five
   root tables (`template`, `experience`, `project`, `technical_skill_row`,
   `resume`) — bullets, skills, bridge rows and PDF snapshots inherit their
   owner through a join to their parent. Isolation is enforced in the
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
- `test` needs `DATABASE_URL` or 16 integration tests silently self-skip and
  still report green. Expect **184 passing, 0 skipped**.
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

**Unattended, through the skills.** `.claude/skills/` holds three —
`/triage`, `/implement`, `/review-pr` — that carry a GitHub issue from
backlog to open PR with nobody watching, and `scripts/herd.sh` starts one
agent per open issue on the skill its `status:*` label calls for. They are
deliberately heavy with ceremony, because the only thing that matters when
no one is watching is an agent that **stops** where a human would otherwise
have interrupted it.

**That is not this.** Those rules live in the skill files and in
`.claude/rules/github.md`, deliberately out of here, so an attended session
never pays for them in context. Each skill is
`disable-model-invocation: true` and fires only when something types
`/triage 12` — never on its own, and never at another skill's request.

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
