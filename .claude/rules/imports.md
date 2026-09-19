---
paths:
  - '**/*.ts'
  - '**/*.tsx'
---

# Import style: two regimes, decided by how the file is executed

There are exactly two, and which one applies is not a preference — it is
determined by the runtime that loads the file. ESLint enforces both.

## `lib/**` and `scripts/**` — relative paths, explicit `.ts` extension

```ts
import { db } from '../db/index.ts';
import type { Selections } from '../types.ts';
```

These trees run under bare `node --experimental-strip-types` for `npm test`,
`npm run smoke`, `npm run db:seed` and `npm run db:migrate`. Node resolves
neither the `@/` alias (that is a webpack/tsconfig `paths` feature) nor an
extensionless specifier. Get either wrong and the file still typechecks and
still builds — it fails only when a script or test actually imports it.

This applies to the whole of `lib/**`, including browser-only modules like
`lib/api-client.ts`, so there is one rule per directory rather than a
per-file judgement call about who might import it next.

## `app/**` and `components/**` — the `@/` alias, no extension

```ts
import { renderResume } from '@/lib/api-client';
import ContentPane from './ContentPane';
```

Webpack resolves both. Use `./Sibling` within a directory and `@/...` for
anything outside it — never `../`, which ESLint rejects here.

## `e2e/**`

Playwright transpiles these, so extensionless relative imports are correct:
`import { login } from './support'`.
