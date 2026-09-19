# Architecture

## One-paragraph summary

Resumix is a Next.js (App Router, TypeScript) app backed by Postgres via Drizzle.
Content (experiences, projects, bullets, skills) is stored once **per user** —
globally within that user's account, never shared between accounts. A
**Resume** is a named selection + ordering of that content, bound to a **Template**
(raw LaTeX with substitution tokens). An **Application** records one job
applied to, and holds both the live resume it was tailored from and the PDF
snapshot it was sent with (D-031). Rendering substitutes selected content into
the template and POSTs the resulting `.tex` to a sidecar TeX Live container, which
returns a PDF. Saved PDFs are snapshotted into Postgres so the home page can always
hand back the exact bytes a resume was last saved with.

## Components

```
                     ┌────────────────────────────┐
  browser ──────────▶│  Next.js (app/ + app/api)  │
   (dev: no token;   │  - React 19 UI             │
    password mode:   │  - route handlers          │
    token in         │  - render engine (pure TS) │
    localStorage)    └───────┬────────────┬───────┘
                             │            │
                    drizzle  │            │ POST /compile {tex}
                             ▼            ▼
                    ┌────────────┐  ┌──────────────────┐
                    │ Postgres   │  │ latex service    │
                    │ (docker /  │  │ texlive + express│
                    │  Supabase) │  │ (docker / Fly.io)│
                    └────────────┘  └──────────────────┘
```

| Concern       | Choice                                                                                                                                                                | Why                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Framework     | Next.js 15 App Router, React 19, TypeScript                                                                                                                           | Vercel target, server + client in one repo                           |
| Styling       | Tailwind CSS v4                                                                                                                                                       | fast, no design system needed                                        |
| DB access     | Drizzle ORM + `postgres.js`, server-side only                                                                                                                         | typed SQL, plain SQL migrations, portable off Supabase               |
| DB (dev)      | `postgres:17` container in docker-compose                                                                                                                             | matches spec's "separate postgres container"                         |
| DB (prod)     | Supabase Postgres via Supavisor pooler                                                                                                                                | just a different `DATABASE_URL`                                      |
| LaTeX         | sidecar container: TeX Live + Express `/compile`                                                                                                                      | real `pdflatex`; V1 template compiles unchanged                      |
| PDF storage   | `resume_pdf.bytes` (`bytea`) behind `lib/storage.ts` adapter                                                                                                          | one code path dev/prod; swap to Supabase Storage later               |
| Multi-tenancy | `user_id` on the six root tables; children inherit through their parent; every query takes a `userId`                                                                 | one source of truth per fact (D-018)                                 |
| Auth          | three modes behind one `requireUserId()`: `dev` (auto-login as the seeded user), `password` (shared password → HMAC token naming a user), `supabase` (OAuth, stubbed) | local dev needs no credentials; production keeps a real gate (D-019) |
| Drag + drop   | `@dnd-kit`                                                                                                                                                            | proven in V1                                                         |
| PDF preview   | `react-pdf` (pdf.js)                                                                                                                                                  | proven in V1                                                         |

## Repo layout

```
app/                     Next.js App Router
  page.tsx               home: the applications board (Pipeline | Applied)
  applications/[id]/     one application: fields, notes, files, its resume
  resumes/page.tsx       the resume library: grid + fuzzy search
  resume/[id]/page.tsx   editor: content|template tabs + live PDF
                         ?application=<id> -> saves back to that application
  api/...                route handlers (see docs/API.md)
lib/
  applications/          status vocabulary, board grouping, attachment rules (pure)
  db/schema.ts           Drizzle table definitions
  db/index.ts            connection singleton
  render/                template token substitution -> .tex  (pure, unit-tested)
  latex.ts               client for the latex service
  storage.ts             PDF snapshot adapter
  auth.ts                password token mint/verify (Edge-safe)
  auth-mode.ts           which auth scheme is in force (Edge-safe)
  auth-supabase.ts       Supabase OAuth seam — NOT IMPLEMENTED, fails closed
  session.ts             requireUserId(request) — the one entry point to "who is calling"
  queries/users.ts       user lookup + first-login provisioning
  filename.ts            Chris_Pyle_<Company>_Resume.pdf
components/              React components
drizzle/                 numbered .sql migrations
scripts/seed.ts          seeds one user + the V1 resume content (the smoke test)
services/latex/          Dockerfile + Express compile service
docs/                    this directory — read STATE.md first
```

## The smoke test

## Who is calling?

```
request
  │
  ├─ middleware.ts (Edge)      cheap, DB-free: rejects a request with no valid
  │                            token in password mode. Knows nothing about users.
  │
  └─ route handler
       └─ requireUserId(request)          lib/session.ts
            ├─ dev      -> first row in `users`
            ├─ password -> token's `sub` claim, confirmed to still exist
            └─ supabase -> verified JWT -> users.supabase_user_id   (stubbed)
       └─ every query takes that id and filters by it
```

Isolation lives in the query layer, not in middleware. Middleware cannot
reach the database (Edge runtime), so it can only answer "is this request
authenticated at all", never "whose is it". Nothing there is load-bearing for
keeping users apart — the `WHERE user_id = ...` clauses are.

## The smoke test

`scripts/seed.ts` must seed the exact content of `../Resume/Chris_Pyle_Resume.tex`,
and rendering the seeded **Default** resume must produce a PDF visually equivalent
to `../Resume/Chris_Pyle_Resume.pdf`. Any schema or renderer change must keep this
true. A copy of the V1 source lives at `docs/reference/v1-resume.tex`.
