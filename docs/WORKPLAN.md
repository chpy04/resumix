# Work plan

Each task is one agent, one git worktree, one branch, merged to `main` by the PM
(the orchestrating agent) after review. Branches: `feat/<task-id>-<slug>`.
Worktrees live in `../resumix-wt/<task-id>` (outside the repo, never committed).

**Merge gate — every branch must pass `npm run verify` before it is merged**
(format:check → lint → typecheck → test → build → reseed → smoke → e2e), plus a
real end-to-end exercise of whatever it built. `tsc --noEmit` is **not**
sufficient on its own: `next build` additionally validates App Router export
signatures, and a page whose default export takes a custom prop typechecks fine
but fails the build. That exact bug reached `main` in T4 because the gate was
typecheck-only. CI runs the same gate — see `.github/workflows/ci.yml`.

Contracts in `docs/SCHEMA.md`, `docs/API.md`, `docs/TEMPLATE_TOKENS.md` are frozen
for the duration of a wave. An agent that needs a contract change must say so in
its report rather than edit the contract unilaterally.

## Wave 0 — foundation (PM, no agents)

- [x] repo scaffold, `.gitignore`, README
- [x] contract docs: ARCHITECTURE, SCHEMA, API, TEMPLATE_TOKENS, DECISIONS
- [x] Next.js + TypeScript + Tailwind skeleton, `package.json`, `docker-compose.yml`, `.env.example`
- [x] `lib/types.ts` — shared TS types every wave-1 task compiles against

## Wave 1 — parallel, no shared files

| id  | task                                                                | owns                                           | branch                  | status    |
| --- | ------------------------------------------------------------------- | ---------------------------------------------- | ----------------------- | --------- |
| T1  | Drizzle schema + SQL migrations + `npm run db:migrate`              | `lib/db/**`, `drizzle/**`                      | `feat/t1-db-schema`     | ✅ merged |
| T2  | LaTeX compile service (Dockerfile + server) + `lib/latex.ts` client | `services/latex/**`, `lib/latex.ts`            | `feat/t2-latex-service` | ✅ merged |
| T3  | Render engine + default template, unit-tested                       | `lib/render/**`                                | `feat/t3-render-engine` | ✅ merged |
| T4  | Auth: password → token, middleware, login screen                    | `lib/auth.ts`, `middleware.ts`, `app/login/**` | `feat/t4-auth`          | ✅ merged |

## Wave 2 — depends on wave 1

| id  | task                                                                                            | owns                                  | branch         | status    |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------- | -------------- | --------- |
| T5  | Seed script: V1 resume content + default template + Default resume + `scripts/smoke.ts`         | `scripts/seed.ts`, `lib/seed-data/**` | `feat/t5-seed` | ✅ merged |
| T6  | API route handlers (all of docs/API.md) + `lib/queries/**`, `lib/storage.ts`, `lib/filename.ts` | `app/api/**`, `lib/queries/**`        | `feat/t6-api`  | ✅ merged |

## Wave 3 — depends on wave 2

| id  | task                                                         | owns                                              | branch            | status    |
| --- | ------------------------------------------------------------ | ------------------------------------------------- | ----------------- | --------- |
| T7  | Home page: resume grid, fuzzy search, new/open/download      | `app/page.tsx`, `components/home/**`              | `feat/t7-home`    | ✅ merged |
| T8  | Editor: content pane, dnd ordering, archive toggle, autosave | `app/resume/[id]/**`, `components/editor/**`      | `feat/t8-editor`  | ✅ merged |
| T9  | Template tab + PDF preview pane + save/download              | `components/preview/**`, `components/template/**` | `feat/t9-preview` | ✅ merged |

T8 and T9 share `app/resume/[id]/page.tsx`; T8 owns it and leaves named mount
points for T9. T9 branches off T8 rather than off `main`.

## Wave 4 — integration

| id  | task                                                                             | status                                                                               |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| T10 | Spec-compliance e2e suite (8 specs, one per spec.md promise)                     | ✅ merged                                                                            |
| T11 | Deployment path (Supabase / Fly.io / Vercel), README, CLAUDE.md, CONTRIBUTING.md | ✅ merged                                                                            |
| T12 | Final review pass → `docs/REVIEW.md`                                             | ✅ done (by the PM; the review agent was killed by a cyber-safeguard false positive) |
