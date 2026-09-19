# Work plan

Each task is one agent, one git worktree, one branch, merged to `main` by the PM
(the orchestrating agent) after review. Branches: `feat/<task-id>-<slug>`.
Worktrees live in `../resumix-wt/<task-id>` (outside the repo, never committed).

Contracts in `docs/SCHEMA.md`, `docs/API.md`, `docs/TEMPLATE_TOKENS.md` are frozen
for the duration of a wave. An agent that needs a contract change must say so in
its report rather than edit the contract unilaterally.

## Wave 0 — foundation (PM, no agents)
- [x] repo scaffold, `.gitignore`, README
- [x] contract docs: ARCHITECTURE, SCHEMA, API, TEMPLATE_TOKENS, DECISIONS
- [x] Next.js + TypeScript + Tailwind skeleton, `package.json`, `docker-compose.yml`, `.env.example`
- [x] `lib/types.ts` — shared TS types every wave-1 task compiles against

## Wave 1 — parallel, no shared files
| id | task | owns | branch | status |
|---|---|---|---|---|
| T1 | Drizzle schema + SQL migrations + `npm run db:migrate` | `lib/db/**`, `drizzle/**` | `feat/t1-db-schema` | ✅ merged |
| T2 | LaTeX compile service (Dockerfile + server) + `lib/latex.ts` client | `services/latex/**`, `lib/latex.ts` | `feat/t2-latex-service` | ✅ merged |
| T3 | Render engine + default template, unit-tested | `lib/render/**` | `feat/t3-render-engine` | in flight |
| T4 | Auth: password → token, middleware, login screen | `lib/auth.ts`, `middleware.ts`, `app/login/**` | `feat/t4-auth` | ✅ merged |

## Wave 2 — depends on wave 1
| id | task | owns | branch |
|---|---|---|---|
| T5 | Seed script: V1 resume content + default template + Default resume | `scripts/seed.ts`, `lib/seed-data/**` | `feat/t5-seed` |
| T6 | API route handlers (all of docs/API.md) + `lib/queries/**` | `app/api/**`, `lib/queries/**` | `feat/t6-api` |

## Wave 3 — depends on wave 2
| id | task | owns | branch |
|---|---|---|---|
| T7 | Home page: resume grid, fuzzy search, new/open/download | `app/page.tsx`, `components/home/**` | `feat/t7-home` |
| T8 | Editor: content pane, dnd ordering, archive toggle, autosave | `app/resume/[id]/**`, `components/editor/**` | `feat/t8-editor` |
| T9 | Template tab + PDF preview pane + save/download | `components/preview/**`, `components/template/**` | `feat/t9-preview` |

T8 and T9 share `app/resume/[id]/page.tsx`; T8 owns it and leaves named mount
points for T9. T9 branches off T8 rather than off `main`.

## Wave 4 — integration
| id | task |
|---|---|
| T10 | End-to-end smoke test: seeded Default renders a PDF matching the V1 resume |
| T11 | Full review pass + deployment notes (Vercel / Fly.io / Supabase) |
