---
paths:
  - 'lib/queries/**'
  - 'lib/db/**'
  - 'lib/storage.ts'
  - 'drizzle/**'
---

# Data access

`docs/SCHEMA.md` is the contract. `lib/queries/**` and `lib/storage.ts` are
the only modules allowed to import `lib/db` — ESLint enforces that boundary
from the other side.

## Never return a raw DB row

Every exported query maps rows through a local `toWire()` before returning.
A spread (`{ ...row, bullets }`) typechecks fine against the wire type and
still ships `createdAt`/`updatedAt`/foreign keys to the browser, silently
widening the API past `docs/API.md`. This drift has already happened once.

```ts
function toWire(row: typeof project.$inferSelect, bullets: Bullet[]): Project {
  return { id: row.id, name: row.name, /* … */ bullets };
}
```

Row types are derived at the use site with `typeof table.$inferSelect`. There
is no separate library of exported `*Record` aliases — one existed, went
entirely unused, and was deleted.

## Every query takes a `userId`

Ownership lives on the seven root tables (`template`, `experience`,
`project`, `technical_skill_row`, `resume`, `cover_letter`, `application`). Everything else —
bullets, skills, bridge rows, PDF snapshots, application files — has **no**
`user_id` and inherits its owner through a join to its parent (D-018). One source of truth per fact: a
`user_id` on a bullet could contradict its experience's.

So every exported query takes `userId` as its first parameter and filters on
it, directly or through that join. A missing filter is silent — the query
still returns rows, just somebody else's. `lib/queries/isolation.test.ts`
holds one case per way of addressing a row by id; add to it when you add a
query.

Bridge rows are the subtle path: they carry no owner at all, so
`replaceSelections` re-checks every content id in the request body against
the caller before writing. Skipping that check would let one user select
another's experience onto their own resume.

## Errors

Throw `NotFoundError` for a missing row and `BadRequestError` for a request
that is well-formed but refers to something invalid (a dangling id, deleting
the default resume). Both come from `lib/queries/errors.ts` and the route
layer maps them. A bare `throw new Error()` is a 500 — use it only for
"this cannot happen" invariants.

## The DB client must stay lazy

`lib/db/index.ts` exports Proxies that construct the `postgres()` client on
first query and cache it on `globalThis`. Never hoist a
`postgres(...)`/`drizzle(...)` call to module scope: `next build` evaluates
every route module while collecting page data, so an eager client breaks the
build on any machine without a live `DATABASE_URL`, including CI (D-014).

## Archive, never delete

No content row is ever deleted. `is_archived` hides it from pickers; resumes
that already selected it keep rendering it forever (D-011). The renderer
deliberately never consults `isArchived`.

## Selections

Bridge-table presence _is_ selection, and array index _is_ `sort_order`
(D-007). `replaceSelections` rewrites each provided slice wholesale inside
one transaction; slices absent from the patch are untouched. Keep it
idempotent — it is called on every debounced keystroke.

## Migrations

Two independent sources of truth that must be kept in agreement by hand:

1. A new numbered plain-SQL file in `drizzle/` (no ORM migration DSL).
2. The matching edit to `lib/db/schema.ts`.

Nothing generates one from the other. Then `npm run db:migrate` (idempotent),
`npm run db:seed -- --force`, and `npm run smoke`.
