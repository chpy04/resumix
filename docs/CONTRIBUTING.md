# Contributing

Short and practical. For the bigger picture start at `docs/STATE.md`; for
per-directory conventions see `.claude/rules/` (and `CLAUDE.md` for the
always-applies half).

## The merge gate

```bash
docker compose up -d db latex
npm run verify
```

`verify` is `format:check → lint → typecheck → test → build → reseed →
smoke → test:e2e`, in that order because each step depends on the last.
Run all of it, not a subset:

- `tsc --noEmit` is **not** sufficient. `next build` additionally validates
  App Router export signatures and resolves the webpack config; a page whose
  default export takes a custom prop typechecks fine and fails the build.
  That bug reached `main` once, which is why `build` is in the gate.
- `npm test` needs `DATABASE_URL` (it reads `.env`). Without it, the 16
  `lib/queries` integration suites self-skip and the run still reports
  green. Expect **110 passing, 0 skipped**.
- `npm run smoke` reads live database state, and a Playwright run leaves
  edited content behind — hence the reseed immediately before it. Running
  `smoke` straight after `test:e2e` will fail the round-trip diff for
  reasons unrelated to your change.

CI (`.github/workflows/ci.yml`) runs the same thing in two jobs: a fast
`check` job, and an `integration` job that brings up Postgres and the LaTeX
sidecar via docker-compose.

## Formatting and linting

Prettier owns formatting; don't hand-format, and don't argue with it. Run
`npm run format`.

`eslint.config.mjs` is deliberately small: the recommended sets, plus
`no-restricted-*` rules that turn the project's invariants into build
failures rather than prose — `components/**` cannot reach `lib/db`, the
Edge-runtime import graph cannot reach `node:crypto`, and each tree's import
style is enforced. Every custom rule's message names the file in
`.claude/rules/` that explains it. If you change a convention, change both
the rule text and the lint config.

## Adding a migration

1. A new numbered plain-SQL file in `drizzle/` (e.g. `0003_your_change.sql`)
   — no ORM migration DSL. `drizzle/0001_skill_row_separator.sql` is a small
   real example.
2. Update `lib/db/schema.ts` by hand to match. The SQL file and the Drizzle
   definitions are two independent sources of truth; nothing generates one
   from the other.
3. If the change affects `docs/SCHEMA.md`, update it in the same commit.
4. `npm run db:migrate` — only applies files not yet in `_migrations`, so
   it's safe to re-run while iterating.
5. `npm run db:seed -- --force && npm run smoke` to confirm the V1 round
   trip still holds.

## Adding an API endpoint

Three layers, in this order (see `.claude/rules/api-routes.md`):

1. **Validation** — a zod schema in `lib/validation.ts`.
2. **Data access** — a query function in `lib/queries/<resource>.ts`. The
   only layer that may import `lib/db`.
3. **Route handler** — a thin `app/api/**/route.ts` using `withApiErrors`,
   `parseJsonBody` and the shared `RouteContext` from `lib/http.ts`.
   Handlers should have almost no logic of their own.

Then update `docs/API.md` in the same commit. Auth is automatic —
`middleware.ts` guards every `/api/*` route except `/api/auth`.

## The smoke test

```bash
docker compose up -d db latex
npm run db:migrate && npm run db:seed -- --force
npm run smoke
```

This is the project's acceptance bar: it reads the seeded Default resume
back out of the database, renders it, diffs the result against
`docs/reference/v1-resume.tex`, and compiles it through the real `pdflatex`
sidecar, asserting a byte-faithful round trip and a 1-page PDF. Any schema
or renderer change must keep it passing.

## Contracts

`docs/SCHEMA.md`, `docs/API.md` and `docs/TEMPLATE_TOKENS.md` describe the
database shape, the HTTP interface and the template token syntax. They are
**contracts**, not incidental notes — other code, and other agents, depend on
them being accurate. Update them deliberately, in the same commit as the
change they describe. If reality and a contract disagree, that is a bug in
one of them: decide which, fix it, and say so. Inside a task/wave where
contracts are declared frozen (`docs/WORKPLAN.md`), propose the change
rather than making it.
