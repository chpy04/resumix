# Deployment

The target from `spec.md`'s Tech stack section: **Supabase (Postgres) + Vercel**
(the Next.js app), plus a separate host for the LaTeX sidecar, which cannot run
on Vercel at all (see "Why not Vercel" below). This doc gives the concrete path
for all three.

**Status: written, not executed.** Nobody has run these steps against a real
Supabase/Fly/Vercel account for this project — there are no credentials for
any of them in this environment. Everything here has been checked for internal
consistency against the code (env var names, the pooler flag, the sidecar's
own README) but the actual `fly deploy` / Vercel import / Supabase project
creation have not happened. Treat this as a validated plan, not a completed
migration. `docs/agents/t11.md` records exactly what was and wasn't run.

## Pre-flight checklist

Before touching any dashboard:

- [ ] `npm run build` succeeds locally with no `.env` present (confirms
      `lib/db/index.ts`'s lazy client doesn't need a live `DATABASE_URL` at
      build time — see D-014 and the troubleshooting section below)
- [ ] `npm run smoke` passes locally against `docker compose up -d db latex`
- [ ] You have a Supabase account, a Fly.io account, and a Vercel account
- [ ] You have a long random string ready for `APP_PASSWORD` and a different
      one for `AUTH_SECRET` (e.g. `openssl rand -base64 32` for each)

## 1. Supabase (Postgres)

1. Create a new Supabase project (any region; pick one close to where Vercel
   will run your functions).
2. In the Supabase dashboard, go to **Project Settings → Database →
   Connection string**, and copy the **connection pooling** string, **not**
   the direct connection string. Use **port 6543** (transaction mode / Supavisor),
   not 5432. It looks like:

   ```
   postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

3. This matters because of how `lib/db/index.ts` is written:

   ```ts
   const client = postgres(url, {
     max: process.env.VERCEL ? 1 : 10,
     prepare: false,
   });
   ```

   `prepare: false` exists *specifically* for this pooler. Supavisor's
   transaction-pooling mode hands out a physical connection per transaction and
   does not support session-scoped prepared statements — `postgres.js`'s
   default behavior (prepare every query) will fail against it. `max: 1` when
   `VERCEL` is set matches the serverless execution model, where each function
   invocation is effectively single-threaded and a bigger local pool just holds
   pooler connections open for nothing. **You don't need to change any code for
   this — it already does the right thing as long as `DATABASE_URL` points at
   port 6543, not 5432.**

4. Run migrations against Supabase from your machine, once, using the pooler
   connection string:

   ```bash
   DATABASE_URL="postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" \
     npm run db:migrate
   ```

   Then seed it the same way (only if you want the V1 resume as your starting
   Default; skip this for a genuinely empty production database):

   ```bash
   DATABASE_URL="..." npm run db:seed
   ```

   `db:migrate` is idempotent (tracks applied files in `_migrations`) and safe
   to re-run from CI or a new machine.

5. Keep this exact connection string for the Vercel env vars in step 3 below.

## 2. The LaTeX sidecar (Fly.io)

**Why not Vercel:** TeX Live is roughly 700MB installed and `pdflatex` needs a
real, writable filesystem for its working directory, font caches, and
auxiliary files per compile. Vercel serverless/edge functions have neither
the image size budget nor a persistent, general-purpose filesystem. This is
D-001 in `docs/DECISIONS.md`. The sidecar needs a host that runs an actual
container: Fly.io, Render, Railway, a VPS — this project uses Fly.io because
`services/latex/` is already a plain Dockerfile with no orchestration
assumptions baked in.

### Deploy

A `services/latex/fly.toml` is checked into the repo already (written but
unexecuted — see the note at the top of this doc). From `services/latex/`:

```bash
cd services/latex
fly launch --no-deploy --name resumix-latex   # detects fly.toml, offers to reuse it
fly deploy
```

`fly launch` will offer to allocate a public IPv4/IPv6. Accept it — see
"Locking it down" below for why a public IP is unavoidable here, and what to
do about it. Confirm it came up:

```bash
fly status
curl https://resumix-latex.fly.dev/health   # {"ok":true}
```

### Scale-to-zero

The checked-in `fly.toml` sets:

```toml
[http_service]
  internal_port = 8080
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

This is a single-user app that compiles a resume a handful of times a day —
there is no reason to pay for an always-on machine. `min_machines_running = 0`
lets Fly stop the machine entirely when idle; `auto_start_machines = true`
brings it back on the next request. The cost of this is a cold-start penalty
(a few seconds) on the first compile after a period of inactivity — acceptable
for this app, and much cheaper than an always-on `shared-cpu-1x`.

### Locking it down

Read `services/latex/README.md`'s Security section first — the short version
is: `-no-shell-escape` is always passed, the service runs as a non-root user
with an isolated temp directory per request, and **it has no authentication of
its own.** Anyone who can reach `POST /compile` can burn your compute
(bounded by `LATEX_MAX_CONCURRENCY`/`LATEX_MAX_QUEUE`) — but per the service's
own design, they cannot read anything outside that request's temp directory,
so the worst case is resource abuse, not a data leak.

The complication: Fly's private networking (6PN / Flycast,
`resumix-latex.internal:8080`) only reaches other apps *inside the same Fly
organization*. Vercel is a different cloud; a Vercel serverless function
cannot join Fly's WireGuard mesh, so it cannot use the fully-private address.
**A public Fly IP is unavoidable for a Vercel → Fly call**, which is the
opposite of what `services/latex/README.md`'s Fly section (written from T2,
before the cross-cloud constraint was fully worked through) implies is
possible. Mitigate it in layers instead of pretending it's fully private:

1. **The browser never sees this URL.** `LATEX_SERVICE_URL` is read only in
   server-side code (`lib/latex.ts`, imported from route handlers) — it is
   never sent to the client, so discovering it requires more than opening dev
   tools on the Resumix site.
2. **Don't rely on the `fly.dev` hostname being secret** — it's derived from
   the app name you chose, which is in this repo's `fly.toml`. If you want any
   obscurity value at all, deploy with a randomized app name instead of
   `resumix-latex` and keep `LATEX_SERVICE_URL` out of anything public.
3. **Bound the blast radius, which is already done:** `-no-shell-escape`, a
   non-root user, and per-request temp dirs mean an unauthenticated caller can
   waste compute but not read app data or secrets off the box. Scale-to-zero
   caps the idle cost at $0.
4. **Set `LATEX_SERVICE_TOKEN` — this is the actual fix, and it is implemented.**
   `services/latex/server.js` requires `Authorization: Bearer <LATEX_SERVICE_TOKEN>`
   on `/compile` and returns `401` without it (compared in constant time);
   `lib/latex.ts` sends it. `/health` stays open so platform health checks work.
   Set the **same** value in both places:

   ```bash
   TOKEN=$(openssl rand -hex 32)
   fly secrets set LATEX_SERVICE_TOKEN="$TOKEN" --app resumix-latex
   vercel env add LATEX_SERVICE_TOKEN production   # paste the same value
   ```

   When the variable is unset the service logs a loud startup warning and stays
   open — acceptable on a private docker network locally, never in a deployment.
   **Treat this as mandatory for any deploy**, not optional hardening: without it
   the public Fly IP above is an open LaTeX compiler.
5. If you truly need zero public exposure and can live without Vercel, the
   alternative is to co-locate: run the Next.js app itself on Fly (a real
   container, not serverless) alongside the sidecar, talking over `localhost`
   or 6PN, with only the Next.js app's port exposed publicly. This sidesteps
   the cross-cloud problem entirely but is a different deployment target than
   the spec asks for, so it's noted here, not adopted.

## 3. Vercel (the Next.js app)

1. Import the repo in the Vercel dashboard ("Add New… → Project"). Framework
   preset: Next.js (auto-detected).
2. Set these environment variables (Project Settings → Environment Variables),
   for both **Production** and **Preview**:

   | Variable | Value | Notes |
   |---|---|---|
   | `DATABASE_URL` | the Supabase **pooler** string from step 1, port **6543** | not the direct :5432 string |
   | `LATEX_SERVICE_URL` | `https://resumix-latex.fly.dev` (your Fly app's public URL) | see the Fly section above |
   | `APP_PASSWORD` | your chosen long password | this gates the whole app |
   | `AUTH_SECRET` | a separate long random string | signs the auth token; do not reuse `APP_PASSWORD` |
   | `PDF_NAME_PREFIX` | e.g. `Chris_Pyle` | filename prefix for downloaded PDFs |
   | `GITHUB_TOKEN` | a PAT with issues + contents write on the repo | powers the "Give feedback" button; without it `POST /api/feedback` returns 503 |
   | `GITHUB_REPO` | `chpy04/resumix` | where feedback issues are filed |

3. Deploy. Vercel runs `npm run build` (or `next build` directly) — this
   should succeed even though `DATABASE_URL` for the *build* environment may
   differ from production, because `lib/db/index.ts` never opens a connection
   at module load (D-014); it only connects on the first actual query, at
   request time.
4. **Render timeout risk.** `POST /api/resumes/:id/render` and
   `POST /api/resumes/:id/pdf` call out to the Fly sidecar over the public
   internet, then wait for a `pdflatex` compile (up to 20s per
   `LATEX_COMPILE_TIMEOUT_MS`) inside that. On Vercel's Hobby plan, serverless
   functions default to a 10s timeout — **shorter than the sidecar's own
   compile timeout**, so a slow compile can hit Vercel's limit before the
   sidecar's. On Pro, the default is 15s and configurable up to 300s via
   `maxDuration` in the route file or `vercel.json`. If renders start timing
   out in production (especially the first request after the Fly machine has
   scaled to zero and needs to cold-start), either raise `maxDuration` on the
   render/pdf routes or accept that the very first render after idle may need
   a retry.

## Troubleshooting

**`DATABASE_URL is not set` during `next build` / Vercel build step**
Should not happen for the Next.js app itself — `lib/db/index.ts`'s client is a
lazy Proxy (D-014) specifically so `next build` never needs a live database.
If you see this from the *app*, check that no other code path evaluates
`sql`/`db` at module scope (e.g. a top-level `await` or a constant computed
outside a handler). If you see this from the `scripts/*.ts` CLI tools instead
(`db:migrate`, `db:seed`, `smoke`), those genuinely require `DATABASE_URL` at
run time — pass it inline (`DATABASE_URL=... npm run db:migrate`) or make sure
`.env` exists locally; they load it automatically via
`--env-file-if-exists=.env`.

**Prepared-statement errors against the pooler**
(`prepared statement "..." already exists`, or `ERROR: prepared statement
does not exist`, or similar from Supavisor.) This means something is
connecting to the **transaction-pooling port (6543)** without
`prepare: false`. `lib/db/index.ts` already sets this for every connection it
opens, so this almost always means a *different* tool is using the same
`DATABASE_URL` — e.g. a GUI client, `psql`, or a one-off script that
constructs its own `postgres()`/`pg` client. Either point that tool at the
**direct** connection string (port 5432, session mode) instead of the pooler,
or make sure it also passes the equivalent of `prepare: false`.

**Unreachable latex service** (`ECONNREFUSED`, `fetch failed`, or renders
that hang until Vercel's own timeout)
1. `curl https://resumix-latex.fly.dev/health` — if this fails, the Fly app
   itself is down; check `fly status` and `fly logs`.
2. If health is fine but compiles fail/hang, the machine may have just been
   woken from scale-to-zero (see "cold start" above) — retry once.
3. Confirm `LATEX_SERVICE_URL` on Vercel has no trailing slash and matches the
   scheme Fly actually serves (`https://`, not `http://`, for the public
   hostname).
4. Confirm you haven't accidentally set `LATEX_SERVICE_URL` to the
   Fly-internal `.internal`/`.flycast` address — those only resolve from
   inside Fly's network, never from Vercel.
