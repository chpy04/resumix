# Contributing

Short and practical. For the bigger picture, start at `docs/STATE.md`.

## Adding a migration

1. Add a new file under `drizzle/`, numbered after the last one (e.g.
   `0002_your_change.sql`), plain SQL — no ORM migration DSL. Look at
   `drizzle/0001_skill_row_separator.sql` for the shape of a small, real one.
2. Update `lib/db/schema.ts` to match by hand — the SQL file and the Drizzle
   table definitions are two independent sources of truth that must agree;
   nothing regenerates one from the other.
3. If the change affects the shape described in `docs/SCHEMA.md`, update that
   doc in the same commit (see "Contracts," below).
4. Run `npm run db:migrate` locally against `docker compose up -d db` — it
   only applies files not yet recorded in `_migrations`, so it's safe to run
   repeatedly as you iterate.
5. Re-run `npm run db:seed -- --force` and `npm run smoke` to confirm the
   round trip against the real V1 resume still holds.

## Adding an API endpoint

Follow the existing three-layer split (see any handler under `app/api/**` for
a live example):

1. **Validation** — add a zod schema to `lib/validation.ts` for the request
   body, if any.
2. **Data access** — add the query function to `lib/queries/**` (one file per
   resource). This is the only layer that imports `lib/db`.
3. **Route handler** — a thin `app/api/<resource>/route.ts` that calls
   `parseJsonBody`/`withApiErrors` from `lib/http.ts`, then the query
   function. Handlers should have almost no logic of their own.
4. Update `docs/API.md` in the same commit (see "Contracts," below).
5. Auth is automatic — `middleware.ts` guards every `/api/*` route except
   `/api/auth`; you don't need to check the token yourself in the handler.

## Running the smoke test

```bash
docker compose up -d db latex
npm run db:migrate
npm run db:seed
npm run smoke
```

This is the project's acceptance bar: it reads the seeded Default resume back
out of the database, renders it, diffs the result against
`docs/reference/v1-resume.tex`, and compiles it through the real `pdflatex`
sidecar, asserting a byte-faithful round trip and a 1-page PDF. Any schema or
renderer change must keep this passing.

## Contracts

`docs/SCHEMA.md`, `docs/API.md`, and `docs/TEMPLATE_TOKENS.md` describe the
database shape, the HTTP interface, and the template token syntax. They are
**contracts**, not incidental notes — other code (and other people/agents)
depend on them being accurate. Update them deliberately, in the same commit
as the code change they describe, not as an afterthought. If you're working
inside a task/wave structure where contracts are declared frozen for the
duration (see `docs/WORKPLAN.md`), don't edit them unilaterally — call out
the needed change instead and let it be reviewed.

## Merge gate

Before merging anything: `npx tsc --noEmit`, `npm test`, `npm run build`,
`npm run smoke`, and `npx playwright test` — all five. See `CLAUDE.md` for
why `tsc --noEmit` alone is not sufficient.
