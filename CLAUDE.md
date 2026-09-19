# CLAUDE.md

Guide for an AI agent picking this repo up cold. This is deliberately thin —
it points at `docs/`, it doesn't duplicate it. Read `docs/STATE.md` first,
then `docs/ARCHITECTURE.md`, then the contracts below, before writing code.

## What this is

Resumix is a Next.js (App Router, TS) app over Postgres (Drizzle). Content
(experiences, projects, bullets, skills) is stored once, globally; a
**Resume** is a named selection + ordering of that content (bridge tables,
composite PKs, `sort_order`), bound to a **Template** (raw LaTeX with
`<<TOKEN>>` placeholders). Rendering = load selections → substitute into the
template → POST the `.tex` to a sidecar TeX Live container
(`services/latex/`) → get a real `pdflatex`-produced PDF back. Saved PDFs are
snapshotted into `resume_pdf` so a resume's downloaded bytes never silently
change when content/templates are edited later. Full detail:
`docs/ARCHITECTURE.md`. Deployment target: Supabase (Postgres) + Vercel (app)

- Fly.io (latex sidecar) — see `docs/DEPLOYMENT.md`.

## Contracts — authoritative, not suggestions

`docs/SCHEMA.md`, `docs/API.md`, `docs/TEMPLATE_TOKENS.md` define the DB
shape, the HTTP interface, and template token syntax. Code must match them;
if reality and a contract disagree, that's a bug in one of them to be fixed
deliberately, not papered over. During a task/wave, contracts are frozen —
propose a change rather than editing one unilaterally. See
`docs/CONTRIBUTING.md` for the workflow to change a contract or add a
migration/endpoint.

## Two invariants that are easy to violate by accident

- **Archive, never delete.** No DELETE endpoints on content. `is_archived`
  hides content from pickers but existing resumes keep rendering it forever.
- **Content is raw, unescaped LaTeX.** Bullets legitimately contain
  `\textbf{}`, `\href{}{}`, `\$`, `\&`. Never add auto-escaping — it would
  corrupt every existing bullet (D-008 in `docs/DECISIONS.md`).

## Merge gate — all five, every branch

```
npx tsc --noEmit
npm test
npm run build
npm run smoke
npx playwright test
```

`tsc --noEmit` is not enough on its own: `next build` additionally validates
App Router export signatures (see the trap below) and actually resolves the
webpack config; a change can typecheck and still fail the build.

## Worktree / branch convention

One task = one agent = one git worktree = one branch. Branches:
`feat/<task-id>-<slug>`. Worktrees: `../resumix-wt/<task-id>/` (outside the
main repo, never committed). `node_modules` is symlinked into each worktree
from the main checkout — don't run `npm install` unless you intend to
replace that symlink with a real local copy (harmless to the main repo, but
wastes ~500MB per worktree and diverges from it). Small, imperative commits.
Every merged task updates `docs/STATE.md`. See `docs/WORKPLAN.md` for the
live task board and `docs/agents/<task-id>.md` for what each task actually
did (including deviations from its brief).

## Traps already discovered (read before you rediscover them)

- **Edge runtime forbids `node:crypto`.** `middleware.ts` runs on the Edge
  runtime. `lib/auth.ts` uses Web Crypto (`crypto.subtle`) exclusively —
  including for timing-safe comparison — so it works identically in
  middleware and in Node route handlers/tests. Don't import `node:crypto`
  anywhere in that import graph.
- **A page's default export can't take a custom prop.** `next build`
  type-checks App Router page/layout default exports against Next's own
  generated types; a prop that isn't part of that shape typechecks fine
  under plain `tsc` but fails `next build`. This exact bug reached `main`
  once (T4/T7) — it's why `build`, not just `typecheck`, is in the merge gate.
- **The DB client must stay lazy.** `next build` evaluates every route module
  while collecting page data. `lib/db/index.ts` exports Proxies that only
  construct the real `postgres()` client on first query, cached on
  `globalThis`. Never hoist a `postgres(...)`/`drizzle(...)` call to module
  scope — it breaks `next build` on any machine (including CI) without a
  live `DATABASE_URL`.
- **react-pdf must be client-only, with a local worker.** `PdfViewer` is only
  ever loaded via `next/dynamic({ ssr: false })` — react-pdf touches
  canvas/DOM APIs unavailable during SSR. Its pdf.js worker is served from a
  hand-copied local static file (`public/pdf.worker.min.mjs`), not a CDN, so
  it can never version-skew against the bundled `pdfjs-dist`. `next.config.ts`
  also aliases `canvas: false` and pins `pdfjs-dist` to its minified build to
  route around a `next dev` HMR bug — see `docs/agents/t9.md` for the full
  story if you need to touch any of this.
