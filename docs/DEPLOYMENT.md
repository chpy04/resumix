# Deployment

Production is a **second copy of Resumix on this same machine**. It has its
own clone, its own Postgres volume, its own images and its own ports; it
holds real resume content; and no development command can reach it. One
script deploys it:

```
npm run deploy:prod
```

That is the whole interface. See D-031 for why it is local rather than
cloud-hosted, and the appendix at the bottom for the Vercel + Fly + Supabase
path that was written, validated, and not taken.

## Why two instances

`npm run verify` runs `npm run db:seed -- --force`, which `TRUNCATE`s every
content table, and then drives Playwright through the app leaving edited
content behind. That is correct — the merge gate needs a database it can
destroy. It just means the development database can never also be the one
holding your real resume.

So the two are disjoint at every layer that could leak:

|          | development               | production                                        |
| -------- | ------------------------- | ------------------------------------------------- |
| source   | this checkout, any branch | `~/.resumix/src`, always `origin/main`            |
| app      | `next dev` on the host    | `resumix-app:prod` container                      |
| database | volume `resumix_pgdata`   | volume `resumix-prod_pgdata`                      |
| compose  | `docker-compose.yml`      | `docker-compose.prod.yml`, project `resumix-prod` |
| web      | 3000 (e2e 3100)           | **39000**                                         |
| postgres | 5433                      | **39432**                                         |
| latex    | 8080                      | **39080**                                         |
| secrets  | `.env`                    | `~/.resumix/prod.env`                             |
| auth     | `dev` — no login screen   | `password`                                        |
| seeding  | `--force`, constantly     | once, on first deploy, never `--force`            |

Production's ports are deliberately odd and bound to `127.0.0.1`, so nothing
that guesses a default port can find it and nothing outside the machine can
reach it at all.

Everything production owns lives under `~/.resumix`, outside the repo:

```
~/.resumix/prod.env      secrets, mode 600, never committed
~/.resumix/src/          the clone deploys build from
~/.resumix/backups/      a pg_dump taken before every migration
```

## Agents do not deploy

`scripts/deploy-prod.sh` exits immediately when `CLAUDECODE` is set, and
`.claude/settings.json` denies the deploy script, the prod compose file and
everything under `~/.resumix/`. The matching prose is CLAUDE.md's
"Production is not yours". If Claude needs a deploy, it should say so and
stop — the refusal is intentional, and routing around it is not a clever
solution to anything.

## First deploy

Prerequisites: Docker Desktop running, and the work you want deployed merged
to `main`.

1. **Bootstrap.**

   ```bash
   npm run deploy:prod
   ```

   With nothing set up yet this clones `origin` into `~/.resumix/src`, copies
   `prod.env.example` to `~/.resumix/prod.env` (mode 600), and stops. It does
   not deploy on this pass — a half-configured production instance is worse
   than none.

2. **Fill in the secrets** in `~/.resumix/prod.env`. Four are required:

   | Variable              | What it is                                                |
   | --------------------- | --------------------------------------------------------- |
   | `POSTGRES_PASSWORD`   | production database password                              |
   | `APP_PASSWORD`        | what you type at the login screen                         |
   | `AUTH_SECRET`         | signs the session token — must differ from `APP_PASSWORD` |
   | `LATEX_SERVICE_TOKEN` | shared secret the app presents to the sidecar             |
   | `OWNER_EMAIL`         | which user the password gate signs in as                  |

   Generate each random one separately with `openssl rand -base64 32`. You
   never write a `DATABASE_URL`: `docker-compose.prod.yml` builds it from
   `POSTGRES_PASSWORD` against the compose network, so there is no line to
   edit that could point production at the development database.

3. **Deploy.**

   ```bash
   npm run deploy:prod
   ```

   On this pass it builds the images, starts Postgres, applies migrations,
   and runs `scripts/seed.ts` **without** `--force`. The seed is a faithful
   transcription of the reference resume, so the first deploy hands you a
   working account with real content; every later deploy finds a user already
   there and no-ops.

4. Open <http://localhost:39000> and log in with `APP_PASSWORD`.

## Every deploy after that

```bash
npm run deploy:prod
```

Idempotent, and always in this order:

1. `git fetch` + `reset --hard origin/main` in `~/.resumix/src` — that clone
   is deploy output and is never edited by hand, so "whatever is on
   `origin/main`" is the only state it may be in. The script prints the
   commit range it is moving across.
2. `docker compose --profile tools build` — from the pulled tree, not from
   your checkout. The profile flag is required, not cosmetic: `migrate` is a
   profiled service and a plain `compose build` skips those silently, which
   would migrate using the previous deploy's image.
3. `pg_dump` into `~/.resumix/backups/` **before** anything touches the
   schema. The last 20 are kept.
4. Migrations, via `docker compose run --rm migrate`. They run inside the
   image built from the same commit, so the schema applied always matches the
   code that will run against it.
5. A check that the schema is level with the commit being deployed: every
   `drizzle/*.sql` in the pulled tree must appear in the database's
   `_migrations`. Compared against the tree rather than by asking the
   migrate container what is pending, because an image that predates a
   migration does not carry the file and would answer "nothing pending"
   quite honestly.
6. `docker compose up -d`, then poll `http://localhost:39000/login` until it
   answers.

Any step failing stops the deploy (`set -euo pipefail`); the currently
running containers keep serving until the final step actually swaps them.
That ordering is the reason the schema check sits before the swap: shipping
code ahead of its schema does not fail during the deploy, it fails later as
500s from whichever query first touches a column that is not there.

## Operating it

```bash
npm run deploy:prod status    # docker compose ps
npm run deploy:prod logs      # follow all services; add a name to narrow
npm run deploy:prod stop      # stop without removing anything
npm run deploy:prod backup    # take a dump now, outside a deploy
```

Containers are `restart: unless-stopped`, so production comes back on its own
when Docker Desktop starts. `stop` is sticky — the next `deploy` starts it
again.

## Backups and restore

Every deploy dumps first, and `backup` dumps on demand. To restore:

```bash
cd ~/.resumix/src
docker compose --env-file ~/.resumix/prod.env -f docker-compose.prod.yml \
  exec -T db psql -U resumix -d resumix < ~/.resumix/backups/<timestamp>.sql
```

These are plain `pg_dump` output of a small database, and they include the
`resume_pdf` snapshots — which is the point, since those bytes are not
reproducible from content once a template or bullet changes (D-011).

## Limits worth knowing

- **One machine.** Loopback-bound, so production exists only on this laptop
  and is down whenever it is asleep. There is no remote access story.
- **`pdflatex` cold path.** The prod sidecar is `restart: unless-stopped`
  rather than scale-to-zero, so there is no cold start, at the cost of an
  idle container.
- **Single-user in practice.** The schema is multi-user but the only
  implemented login is the shared password, which signs in as `OWNER_EMAIL`.
  See "A note on multi-user" in the appendix.

## Troubleshooting

**`refusing to deploy: CLAUDECODE is set`** — working as designed; run it in
your own shell rather than through an agent.

**`~/.resumix/prod.env is mode 644`** — `chmod 600 ~/.resumix/prod.env`.

**`database did not become ready in 60s`** — `npm run deploy:prod logs db`.
Usually a port clash on 39432 or a volume left mid-upgrade by a Postgres
major bump.

**A port is already in use** — something else grabbed 39000/39432/39080.
These are only defaults; change them in `docker-compose.prod.yml` and update
the table in `docs/STATE.md`.

**Production and development disagree about the schema** — they are separate
databases with separate `_migrations` tables, which is intended. `npm run
deploy:prod` is the only thing that migrates production, and it only ever
applies what is on `origin/main`.

---

# Appendix: the cloud path, not taken

Everything below describes deploying to **Supabase + Fly.io + Vercel**. It
was written and checked for internal consistency against the code, but it has
never been executed and is not the current deployment (D-031). It is kept
because `services/latex/fly.toml` is still checked in and the constraints it
documents — above all why `pdflatex` cannot run on Vercel — remain true.

**Pre-flight, if you ever take this path:** confirm `npm run build` succeeds
with no `.env` present (D-014), confirm `npm run smoke` passes locally, and
have Supabase, Fly.io and Vercel accounts plus two long random strings ready.

## A1. Supabase (Postgres)

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

   `prepare: false` exists _specifically_ for this pooler. Supavisor's
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

## A2. The LaTeX sidecar (Fly.io)

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
unexecuted — see the appendix preamble above). From `services/latex/`:

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
`resumix-latex.internal:8080`) only reaches other apps _inside the same Fly
organization_. Vercel is a different cloud; a Vercel serverless function
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

## A3. Vercel (the Next.js app)

1. Import the repo in the Vercel dashboard ("Add New… → Project"). Framework
   preset: Next.js (auto-detected).
2. Set these environment variables (Project Settings → Environment Variables),
   for both **Production** and **Preview**:

   | Variable            | Value                                                       | Notes                                                                                                                                               |
   | ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `DATABASE_URL`      | the Supabase **pooler** string from step 1, port **6543**   | not the direct :5432 string                                                                                                                         |
   | `LATEX_SERVICE_URL` | `https://resumix-latex.fly.dev` (your Fly app's public URL) | see the Fly section above                                                                                                                           |
   | `RESUMIX_AUTH_MODE` | `password`                                                  | the default in production, but set it explicitly. **Never `dev`** — that disables the login screen entirely and signs everyone in as the first user |
   | `OWNER_EMAIL`       | the email of the seeded user                                | which account the shared password logs in as; optional while there is exactly one user, required once there are more                                |
   | `APP_PASSWORD`      | your chosen long password                                   | this gates the whole app                                                                                                                            |
   | `AUTH_SECRET`       | a separate long random string                               | signs the auth token; do not reuse `APP_PASSWORD`                                                                                                   |
   | `PDF_NAME_PREFIX`   | e.g. `Chris_Pyle`                                           | filename prefix for downloaded PDFs                                                                                                                 |
   | `GITHUB_TOKEN`      | a PAT with issues + contents write on the repo              | powers the "Give feedback" button; without it `POST /api/feedback` returns 503                                                                      |
   | `GITHUB_REPO`       | `chpy04/resumix`                                            | where feedback issues are filed                                                                                                                     |

3. Deploy. Vercel runs `npm run build` (or `next build` directly) — this
   should succeed even though `DATABASE_URL` for the _build_ environment may
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

## A note on multi-user (T14)

The database supports many users, but the only implemented login is the
shared password, which cannot tell people apart — it signs in as one account
(`OWNER_EMAIL`). **A deployment today is therefore effectively single-user**,
running on multi-user foundations. Inviting anyone else means implementing
Supabase OAuth first: `lib/auth-supabase.ts`, then `RESUMIX_AUTH_MODE=supabase`.

## Cloud troubleshooting

**`DATABASE_URL is not set` during `next build` / Vercel build step**
Should not happen for the Next.js app itself — `lib/db/index.ts`'s client is a
lazy Proxy (D-014) specifically so `next build` never needs a live database.
If you see this from the _app_, check that no other code path evaluates
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
opens, so this almost always means a _different_ tool is using the same
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
