# Architecture

## One-paragraph summary

Resumix is a Next.js (App Router, TypeScript) app backed by Postgres via Drizzle.
Content (experiences, projects, bullets, skills) is stored once, globally. A
**Resume** is a named selection + ordering of that content, bound to a **Template**
(raw LaTeX with substitution tokens). Rendering substitutes selected content into
the template and POSTs the resulting `.tex` to a sidecar TeX Live container, which
returns a PDF. Saved PDFs are snapshotted into Postgres so the home page can always
hand back the exact bytes a resume was last saved with.

## Components

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
                    │ (docker /  │  │ texlive + express│
                    │  Supabase) │  │ (docker / Fly.io)│
                    └────────────┘  └──────────────────┘
```

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript | Vercel target, server + client in one repo |
| Styling | Tailwind CSS v4 | fast, no design system needed |
| DB access | Drizzle ORM + `postgres.js`, server-side only | typed SQL, plain SQL migrations, portable off Supabase |
| DB (dev) | `postgres:17` container in docker-compose | matches spec's "separate postgres container" |
| DB (prod) | Supabase Postgres via Supavisor pooler | just a different `DATABASE_URL` |
| LaTeX | sidecar container: TeX Live + Express `/compile` | real `pdflatex`; V1 template compiles unchanged |
| PDF storage | `resume_pdf.bytes` (`bytea`) behind `lib/storage.ts` adapter | one code path dev/prod; swap to Supabase Storage later |
| Auth | single shared password → HMAC token in `localStorage`, checked by middleware | single-user, per spec |
| Drag + drop | `@dnd-kit` | proven in V1 |
| PDF preview | `react-pdf` (pdf.js) | proven in V1 |

## Repo layout

```
app/                     Next.js App Router
  page.tsx               home: resume grid + fuzzy search
  resume/[id]/page.tsx   editor: content|template tabs + live PDF
  api/...                route handlers (see docs/API.md)
lib/
  db/schema.ts           Drizzle table definitions
  db/index.ts            connection singleton
  render/                template token substitution -> .tex  (pure, unit-tested)
  latex.ts               client for the latex service
  storage.ts             PDF snapshot adapter
  auth.ts                password token mint/verify
  filename.ts            Chris_Pyle_<Company>_Resume.pdf
components/              React components
drizzle/                 numbered .sql migrations
scripts/seed.ts          seeds V1 resume content (the smoke test)
services/latex/          Dockerfile + Express compile service
docs/                    this directory — read STATE.md first
```

## The smoke test

`scripts/seed.ts` must seed the exact content of `../Resume/Chris_Pyle_Resume.tex`,
and rendering the seeded **Default** resume must produce a PDF visually equivalent
to `../Resume/Chris_Pyle_Resume.pdf`. Any schema or renderer change must keep this
true. A copy of the V1 source lives at `docs/reference/v1-resume.tex`.
