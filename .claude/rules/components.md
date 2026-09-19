---
paths:
  - 'components/**'
  - 'app/**/*.tsx'
---

# React components

## File shape

One component per file, `export default function Name(props: NameProps)`,
named to match the file. Props are a local `interface NameProps` above the
component with a doc comment on anything non-obvious. The exception is
`components/editor/atoms.tsx`, which named-exports several tiny shared
primitives.

Any file with state, effects, event handlers or hooks starts with
`'use client'`. The app is client-heavy by design: the editor is one live
document, not a set of forms.

## Never call `fetch`

Every request goes through `lib/api-client.ts`, which is the only module
that knows URL shapes, and which routes through `authedFetch` for the token
and the 401 → logout path. Adding an endpoint means adding a function
there, not a `fetch` in a component. ESLint blocks bare `fetch` here.

`lib/api-client.ts` throws `ApiError` (carrying `status` and the server's
`{ error }` message) on any non-2xx. Catch it and show the message; do not
let it reach the user as a blank screen.

## No server-side data access

`components/**` and `app/**` may not import `lib/db`, `drizzle-orm` or
`postgres` (ESLint enforced). Data arrives over the API.

## Autosave, never a save button

The editor has no Save. Mutations go through `createAutosave` from
`lib/editor/autosave.ts` — debounce ~500ms for text, 0 for toggles and
reorders. Statuses from every channel are aggregated into the one
`SaveStatusBadge` in the header. A failed save must surface as `'error'`
with a working retry; never swallow one.

## Keep logic out of components

Pure, testable logic lives in `lib/editor/**` (`selections-reducer.ts`,
`visibility.ts`, `autosave.ts`) and is unit-tested there. Components wire
it up and render. If you are about to write a non-trivial `useMemo`, check
whether it belongs in `lib/editor/` with a test instead.

## Two behaviours that are easy to break

- **Editing content is global.** A bullet belongs to the library, not to the
  open resume; editing it changes every resume that selected it. That is
  intentional and the UI must keep saying so (`GlobalEditBadge`).
- **Archived-but-selected must stay visible.** `lib/editor/visibility.ts`
  exists so a user can never end up with content on their PDF that they can
  no longer find or deselect. Route visibility decisions through it.

## Drag and drop

One `SortableList` (its own `DndContext`) per list — there is no
cross-list dragging. Rows are `SortableRow`, which renders its own
`DragHandle`. Reordering hands back the complete new id order.
