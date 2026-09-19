# Resumix

Resumix is a resume-tailoring workbench. The core idea: **content is global,
a resume is a selection.** Every experience, project, bullet, and skill you
have ever written lives once in the database. A "resume" doesn't store any
text of its own — it stores *which* of that content you picked for this
application and in what order. Edit a bullet once and it updates on every
resume that uses it. Composing a resume for a new company is picking and
reordering existing content, not retyping it. When you're happy, you render
the selection into a LaTeX template and get back a PDF, which is then
snapshotted so it never silently changes underneath you later.

Single-user, password-gated, backed by Postgres and a real `pdflatex`
sidecar (not a WASM approximation — the LaTeX is the same LaTeX that
compiles your actual resume).

See [docs/STATE.md](docs/STATE.md) for current project status,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design, and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for how to run this in production.

## Architecture, in one picture

```
                     ┌────────────────────────────┐
  browser ──────────▶│  Next.js (app/ + app/api)  │
   (password token   │  - React 19 UI             │
    in localStorage) │  - route handlers          │
                     │  - render engine (pure TS) │
                     └───────┬────────────┬───────┘
                             │            │
                    drizzle  │            │ POST /compile {tex}
                             ▼            ▼
                    ┌────────────┐  ┌──────────────────┐
                    │ Postgres   │  │ latex service    │
                    │ (docker /  │  │ texlive + node:http │
                    │  Supabase) │  │ (docker / Fly.io)│
                    └────────────┘  └──────────────────┘
```

Rendering = load your selections → substitute them into the template's
`<<TOKEN>>` placeholders → POST the resulting `.tex` to the sidecar →
get a PDF back. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
full component table and repo layout.

## Quick start

This is the exact sequence verified against a clean checkout. It assumes
Docker Desktop (or equivalent) and Node 22+ (this repo relies on
`node --experimental-strip-types`, which needs a recent Node — v25 was used
to verify this).

```bash
git clone <this repo> && cd resumix

# 1. Environment
cp .env.example .env
# the defaults work as-is for local dev; only change APP_PASSWORD/AUTH_SECRET
# if you want a real password gate instead of the placeholder

# 2. Postgres + the LaTeX compile sidecar, in containers
docker compose up -d db latex
# first run builds the latex image (TeX Live), which can take a few minutes

# 3. App dependencies
npm install

# 4. Apply migrations, then seed the real V1 resume as "Default"
npm run db:migrate
npm run db:seed

# 5. Run it
npm run dev
```

Open http://localhost:3000, log in with the `APP_PASSWORD` from `.env`, and
you should see one resume, "Default", ready to open, edit, and re-render.

To confirm the whole pipeline end-to-end without opening a browser:

```bash
npm run smoke
```

This reads the seeded Default resume back out of the database, renders it,
diffs the output against `docs/reference/v1-resume.tex`, and compiles it
through the real `pdflatex` sidecar — asserting a byte-faithful round trip
and a 1-page PDF. This is the project's acceptance bar (see
`docs/ARCHITECTURE.md#the-smoke-test`).

## Command reference

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000, hot reload |
| `npm run build` | Production build (`next build`); also the strictest typecheck (validates App Router export signatures, not just types) |
| `npm start` | Run the production build (`next start`) |
| `npm test` | Unit tests (`node --test`) across `lib/**/*.test.ts` — pure logic; DB-backed tests self-skip if `DATABASE_URL` isn't reachable |
| `npm run test:e2e` | Playwright browser tests (`e2e/**`); spins up its own dev server on :3100 and **force-reseeds the database** — see `playwright.config.ts` before running against data you care about |
| `npm run db:migrate` | Applies any `drizzle/*.sql` files not yet recorded in `_migrations`. Idempotent — safe to re-run. |
| `npm run db:seed` | Seeds the real V1 resume content + Default template + Default resume. Refuses to run twice unless you pass `--force` (wipes and reseeds) |
| `npm run smoke` | The end-to-end check described above: DB → render → compile → assert |
| `npx tsc --noEmit` | Typecheck only (faster than `build`, but not sufficient on its own — see the note above) |
| `npm run lint` | `next lint` |

`db:migrate`, `db:seed`, and `smoke` load `.env` automatically (via Node's
`--env-file-if-exists`) if one is present, and fall back to whatever is
already in your shell environment otherwise — so they work the same way
locally and in CI/production where env vars are injected directly.

## Project layout

```
app/                     Next.js App Router (pages + app/api/** route handlers)
lib/                     db schema/client, render engine, auth, queries, storage
components/              React components
drizzle/                 numbered .sql migrations
scripts/                 migrate.ts, seed.ts, smoke.ts
services/latex/          the pdflatex sidecar (Dockerfile + server.js)
e2e/                     Playwright specs
docs/                    architecture, contracts, decisions, deployment — see below
```

## Where to go next

- [docs/STATE.md](docs/STATE.md) — what's built, what's in flight
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, repo layout, the smoke test
- [docs/SCHEMA.md](docs/SCHEMA.md), [docs/API.md](docs/API.md), [docs/TEMPLATE_TOKENS.md](docs/TEMPLATE_TOKENS.md) — frozen contracts
- [docs/DECISIONS.md](docs/DECISIONS.md) — why things are the way they are
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Supabase + Fly.io + Vercel, step by step
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — adding a migration, an endpoint, running the smoke test
- [CLAUDE.md](CLAUDE.md) — guide for an AI agent picking this repo up cold
- `services/latex/README.md` — the sidecar's own contract, security notes, and Fly.io deploy notes
