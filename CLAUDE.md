# CLAUDE.md

Deliberately thin. It carries what must be in context for _every_ change;
everything directory-specific lives in `.claude/rules/`, which loads only
when you touch matching files. Read `docs/STATE.md` first, then
`docs/ARCHITECTURE.md`.

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
  still report green. Expect **170 passing, 0 skipped**.
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

## Contracts

`docs/SCHEMA.md`, `docs/API.md`, `docs/TEMPLATE_TOKENS.md` are authoritative.
Code must match them; a disagreement is a bug in one of them to be fixed
deliberately, not papered over. Update the contract in the same commit as
the code. During a declared wave they are frozen — propose, don't edit.

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
- Every merged change updates `docs/STATE.md`.

## Worktree / branch convention

One task = one agent = one git worktree = one branch.
Branches `feat/<task-id>-<slug>`; worktrees at `../resumix-wt/<task-id>/`,
outside the repo, never committed. `node_modules` is symlinked in from the
main checkout — don't run `npm install` in a worktree unless you mean to
replace that symlink. Small, imperative commits. `docs/WORKPLAN.md` is the
task board; `docs/agents/<task-id>.md` is what each task actually did.

## Traps already discovered

- **A page's default export can't take a custom prop.** `next build`
  type-checks App Router page/layout default exports against Next's own
  generated types. Plain `tsc` passes; the build fails.
- **react-pdf must be client-only, with a local worker.** `PdfViewer` is only
  ever loaded via `next/dynamic({ ssr: false })`. Its pdf.js worker is a
  hand-copied static file (`public/pdf.worker.min.mjs`), never a CDN, so it
  cannot version-skew against the bundled `pdfjs-dist`. `next.config.ts` also
  aliases `canvas: false` and pins `pdfjs-dist` to its minified build to route
  around a `next dev` HMR bug — see `docs/agents/t9.md` before touching any
  of it.
- **Ports**: web 3000 (e2e uses 3100), latex 8080, postgres **5433** — 5432
  is usually already taken.
