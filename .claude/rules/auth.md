---
paths:
  - 'lib/auth.ts'
  - 'lib/auth-mode.ts'
  - 'lib/auth-supabase.ts'
  - 'lib/auth-client.ts'
  - 'lib/api-tokens.ts'
  - 'lib/session.ts'
  - 'middleware.ts'
  - 'scripts/token-*.ts'
  - 'app/api/auth/**'
  - 'app/api/session/**'
  - 'app/login/**'
  - 'components/AuthGate.tsx'
  - 'components/LoginForm.tsx'
---

# Auth

Every request resolves to a row in `users`. How it gets there depends on
`RESUMIX_AUTH_MODE` (`lib/auth-mode.ts`), which defaults to `dev` outside
production and `password` in production — so shipping cannot turn the gate
off by omission (D-019).

| mode       | who the caller is                                            | notes                                                                  |
| ---------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `dev`      | the first row in `users` — whoever `npm run db:seed` created | **no login screen at all**; local development only                     |
| `password` | shared `APP_PASSWORD` → HMAC token naming one user (D-010)   | the only non-local path today; token in `localStorage`                 |
| `supabase` | a verified Supabase JWT → `users.supabase_user_id`           | **not implemented**; `lib/auth-supabase.ts` throws, so it fails closed |

## Two entry points, one per surface

`lib/session.ts` resolves the caller; handlers call it and pass the id down
(see `.claude/rules/api-routes.md`). There is no ambient "current user" and
no query runs without one being named. It has exactly two doors, and a
handler uses one:

- **`requireUserId()`**, for every route but `/api/mcp/**`. It follows the
  mode in the table above.
- **`requireMcpUserId()`**, for `/api/mcp/**` only. It takes an `rmx_` API
  token and **never consults the mode** (below).

Neither accepts the other's credential.

**Middleware is not what keeps accounts apart.** It runs on the Edge runtime
and cannot reach the database, so it can only answer "is this request
authenticated at all". Isolation lives in the query layer's `WHERE` clauses,
and `lib/queries/isolation.test.ts` is its executable form.

In `password` mode the token is minted for `OWNER_EMAIL`, or for the only
user in the table if that is unset. With several users and no `OWNER_EMAIL`,
login is **refused** rather than guessed — one shared password cannot tell
people apart. That ambiguity is what Supabase OAuth exists to resolve.
`resolveOwnerUser` (`lib/queries/users.ts`) is that rule, and the token
scripts use it too.

## API tokens (`/api/mcp/**`)

The agent's credential (D-039). `Authorization: Bearer rmx_…`, where the
secret is 32 random bytes and only its sha-256 is stored, in `api_token`.

- **Every mode, `dev` included.** `requireMcpUserId` does not call
  `getAuthMode()`. Dev mode's "no login" is for a browser on this machine;
  honouring it here would hand the account to anything that reaches the port.
  No token is a `401`, always.
- **Middleware lets `/api/mcp/**` through** (`isMcpPath`, `lib/auth-mode.ts`).
  Only a database lookup can tell one token from another, so the handler does
  the whole check. Passing through is still fail-closed for that reason.
- **The two credentials never cross.** `x-resumix-token` is not read under
  `/api/mcp/**`, and every other route reads only `x-resumix-token`, which an
  `rmx_` secret never verifies as.
- Missing, unknown and revoked tokens get the same `401` body, so a refusal
  never confirms a token existed.
- Tokens are made and revoked by `npm run token:create` / `token:revoke`,
  never over HTTP. Revoking sets `revoked_at`; the row is never deleted.

## Web Crypto only — no `node:crypto`

`middleware.ts` runs on the **Edge runtime**, which has no `node:crypto`.
`lib/auth.ts` therefore uses `crypto.subtle` exclusively, including for
timing-safe comparison (it hashes both sides and compares the digests,
because there is no Edge equivalent of `timingSafeEqual`). ESLint blocks the
import in `middleware.ts`, `lib/auth.ts` and `lib/auth-mode.ts`, but the ban
is transitive in a way ESLint cannot see:
**nothing reachable from `middleware.ts` may import `node:crypto`.** Check
the whole import graph before adding a dependency here.

`lib/session.ts` touches the database, and `lib/api-tokens.ts` hashes with
`node:crypto`, so both are server-only and must never be imported from
`middleware.ts` or from `components/**`. ESLint bans session, API-token,
query and DB modules in the three Edge files named above, so the import that
would pull either one into the Edge graph is the one that fails.

Web Crypto is also a Node global, so the same code runs unchanged in route
handlers and in `node --test`.

## Fail closed

A missing `APP_PASSWORD` or `AUTH_SECRET` rejects every login and every
token, and logs why. An unimplemented mode rejects every request. Never fall
back to a default secret, a default user, or skip verification when config
is absent.

Tokens carry a version. Bumping it (as `sub` did, 1 → 2, D-020) logs
everyone out, which is the honest answer to a token whose claims no longer
mean what the code assumes.

## Client side

`lib/auth-client.ts` owns the token: `getToken`/`setToken`/`clearToken`, and
`authedFetch`, which attaches `x-resumix-token` and — on a 401 — clears the
token and dispatches `AUTH_EXPIRED_EVENT` so `AuthGate` can drop to the
login screen without a reload. Components never read `localStorage`
directly.

`AuthGate` asks the server `GET /api/session` rather than treating a stored
token as proof: in `dev` mode there is no token to store, and only the
server knows which mode is running.

`POST /api/auth` is the one request that cannot use `authedFetch` (there is
no token yet, and a wrong password is an expected outcome rather than an
expired session). It lives in `lib/api-client.ts` as `login()` so components
still never call `fetch` themselves.
