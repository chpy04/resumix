---
paths:
  - '**/*.test.ts'
  - 'e2e/**'
  - 'scripts/**'
  - 'playwright.config.ts'
---

# Tests

Three tiers, three purposes. No mocking framework, no assertion library —
`node:test` + `node:assert/strict` and Playwright, nothing else.

## `lib/**/*.test.ts` — `npm test`

Runs under `node --experimental-strip-types`, so imports need explicit
`.ts` extensions (see `.claude/rules/imports.md`).

Two kinds live side by side:

- **Pure logic** (`render`, `autosave`, `visibility`, `selections-reducer`,
  `fuzzy`, `filename`, `auth`) — no DB, always runs.
- **Query integration** (`lib/queries/*.test.ts`) — hits a **real Postgres**,
  never a mock. Each file self-skips via `{ skip: !hasDatabase }` from
  `lib/queries/test-fixtures.ts` when `DATABASE_URL` is unset.

That skip is a trap worth knowing: without `DATABASE_URL` these 16 tests
vanish and `npm test` still reports green. The `test` script passes
`--env-file-if-exists=.env` for exactly that reason. If your test count
drops below 143, your `.env` is missing, not your code.

Fixtures never assume an empty database and never touch rows they did not
create (the dev DB is shared). Content rows are left behind, tagged with a
random suffix; resumes are cleaned up. Every DB test file needs a top-level
`after(closeTestDb)` or the process will not exit.

## `e2e/**` — `npx playwright test`

One spec per behavioural promise in `spec.md`. They drive the real UI
against a real dev server, a real Postgres and the real LaTeX sidecar —
`docker compose up -d db latex` must already be running; the `webServer`
block seeds the DB and starts Next itself.

Shared helpers go in `e2e/support.ts` (`login`, `createResumeViaUi`,
`waitForSaved`, `extractPdfText`, …). Assert on user-visible behaviour, and
where the claim is "this actually reached the PDF", extract the text with
`pdfjs-dist` rather than diffing screenshots.

These tests mutate the seeded content. Reseed before running `npm run smoke`.

## `scripts/smoke.ts` — `npm run smoke`

Not a unit test: the project's acceptance bar. See
`.claude/rules/render-latex.md`.

## Adding a test

New behaviour needs a test at the cheapest tier that can prove it. Pure
logic belongs in `lib/`, not in a Playwright spec — if you find yourself
wanting an e2e test for a calculation, extract the calculation.
