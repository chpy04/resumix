---
paths:
  - 'lib/auth.ts'
  - 'lib/auth-client.ts'
  - 'middleware.ts'
  - 'app/api/auth/**'
  - 'app/login/**'
  - 'components/AuthGate.tsx'
  - 'components/LoginForm.tsx'
---

# Auth

One shared password → an HMAC-SHA256 token in `localStorage`, verified by
middleware on every `/api/*` request (D-010). Single-user by design; there
are no accounts.

## Web Crypto only — no `node:crypto`

`middleware.ts` runs on the **Edge runtime**, which has no `node:crypto`.
`lib/auth.ts` therefore uses `crypto.subtle` exclusively, including for
timing-safe comparison (it hashes both sides and compares the digests,
because there is no Edge equivalent of `timingSafeEqual`). ESLint blocks the
import in both files, but the ban is transitive in a way ESLint cannot see:
**nothing reachable from `middleware.ts` may import `node:crypto`.** Check
the whole import graph before adding a dependency here.

Web Crypto is also a Node global, so the same code runs unchanged in route
handlers and in `node --test`.

## Fail closed

A missing `APP_PASSWORD` or `AUTH_SECRET` rejects every login and every
token, and logs why. Never fall back to a default secret or skip
verification when config is absent.

## Client side

`lib/auth-client.ts` owns the token: `getToken`/`setToken`/`clearToken`, and
`authedFetch`, which attaches `x-resumix-token` and — on a 401 — clears the
token and dispatches `AUTH_EXPIRED_EVENT` so `AuthGate` can drop to the
login screen without a reload. Components never read `localStorage`
directly.

`POST /api/auth` is the one request that cannot use `authedFetch` (there is
no token yet, and a wrong password is an expected outcome rather than an
expired session). It lives in `lib/api-client.ts` as `login()` so components
still never call `fetch` themselves.
