# Deployment

Production is a **cloud VM that runs Docker and nothing else**. It has its
own clone, its own Postgres volume and its own images; it holds real resume
content; and it is deployed by hand, with `docker compose`, from a shell on
the VM. HTTPS in front of it is not part of this repo (D-051).

The appendix at the bottom describes the Vercel + Fly + Supabase path that
was written, validated, and not taken.

## Why a separate instance

`npm run verify` runs `npm run db:seed -- --force`, which `TRUNCATE`s every
content table, and then drives Playwright through the app leaving edited
content behind. That is correct — the merge gate needs a database it can
destroy. It just means the development database can never also be the one
holding your real resume.

So the two are disjoint at every layer that could leak:

|          | development               | production                                        |
| -------- | ------------------------- | ------------------------------------------------- |
| machine  | your laptop               | the VM                                            |
| source   | this checkout, any branch | `~/.resumix/src` on the VM, at the deployed ref   |
| app      | `next dev` on the host    | `resumix-app:prod` container                      |
| database | volume `resumix_pgdata`   | volume `resumix-prod_pgdata`                      |
| compose  | `docker-compose.yml`      | `docker-compose.prod.yml`, project `resumix-prod` |
| web      | 3000 (e2e 3100)           | `127.0.0.1:39000`, behind HTTPS                   |
| postgres | 5433                      | `127.0.0.1:39432`                                 |
| latex    | 8080                      | `127.0.0.1:39080`                                 |
| secrets  | `.env`                    | `~/.resumix/prod.env` on the VM                   |
| auth     | `dev` — no login screen   | `password`                                        |
| seeding  | `--force`, constantly     | once, on the first deploy, never `--force`        |

Everything production owns lives under `~/.resumix` on the VM, outside the
clone:

```
~/.resumix/prod.env      secrets, mode 600, never committed
~/.resumix/src/          the clone deploys build from, never edited by hand
~/.resumix/backups/      a pg_dump taken before every migration
```

## HTTPS is in front, and not in this repo

`docker-compose.prod.yml` binds every port to `127.0.0.1`, so the app is
reachable only at `127.0.0.1:39000` on the VM itself, and Postgres and the
LaTeX sidecar not at all from off it. Whatever terminates HTTPS runs on the
VM host, or tunnels into it, and forwards to that address. The repo carries
no proxy, certificate or DNS configuration, and nothing reaches production
over plain HTTP:

- The browser uses `https://<host>`.
- The applying agent's `RESUMIX_MCP_URL` is `https://<host>/api/mcp`. Apply
  packets' file paths resolve against it (D-050), so there is no separate
  base URL to keep in step.
- `/api/auth` has no rate limit, so on a public URL `APP_PASSWORD` is the
  whole gate on the UI. Make it long and random.

Never forward 39432 or 39080. The database has only its password, and the
sidecar runs `pdflatex` on whatever it is handed (`services/latex/README.md`).

## Agents do not deploy

Only Chris reaches the VM. No agent opens a shell on it, calls its URL, or
holds a production token anywhere but `agent/.env` (CLAUDE.md, "Production is
not yours"). There is no script on the VM for an agent to be stopped by: what
keeps agents out is that the credentials exist only there and in
`agent/.env`, which `.claude/settings.json` denies.

## First deploy

Prerequisites on the VM:

- Docker Engine with the Compose plugin (`docker compose version`), with the
  daemon enabled at boot, so `restart: unless-stopped` brings production back
  after a reboot.
- `git`, with read access to the repo.
- Enough memory to build. Images build on the VM, and `next build` inside
  Docker is the step that needs it; see Troubleshooting for exit 137.
- The HTTPS front end, forwarding to `127.0.0.1:39000`.

1. **Clone** the ref you are deploying, normally `main`:

   ```bash
   mkdir -p ~/.resumix/backups && chmod 700 ~/.resumix
   git clone --branch main <repo-url> ~/.resumix/src
   ```

2. **Write the secrets.**

   ```bash
   cp ~/.resumix/src/prod.env.example ~/.resumix/prod.env
   chmod 600 ~/.resumix/prod.env
   ```

   Five are required, and compose refuses to start without any of them:

   | Variable              | What it is                                                |
   | --------------------- | --------------------------------------------------------- |
   | `POSTGRES_PASSWORD`   | production database password                              |
   | `APP_PASSWORD`        | what you type at the login screen                         |
   | `AUTH_SECRET`         | signs the session token — must differ from `APP_PASSWORD` |
   | `LATEX_SERVICE_TOKEN` | shared secret the app presents to the sidecar             |
   | `OWNER_EMAIL`         | which user the password gate signs in as                  |

   Set `SEED_USER_NAME` as well. Left blank, compose passes it as an empty
   string, and the seed stores that instead of its default.

   Generate each random value separately with `openssl rand -hex 32`. **Hex,
   not base64:** `POSTGRES_PASSWORD` is spliced unescaped into the app's
   `DATABASE_URL`, and a `/` from base64 makes that URL unparseable. Compose
   also expands `$` in unquoted values, so single-quote an `APP_PASSWORD`
   that contains one. You never write a `DATABASE_URL` yourself:
   `docker-compose.prod.yml` builds it against the compose network, so no
   line in the env file can point production at another database.

3. **Define the shorthand** every command below uses, from the clone:

   ```bash
   cd ~/.resumix/src
   prod() { docker compose --env-file ~/.resumix/prod.env -f docker-compose.prod.yml "$@"; }
   ```

4. **Build, migrate, seed, start.**

   ```bash
   prod --profile tools build
   prod up -d --wait db
   prod run --rm migrate
   prod run --rm migrate npm run db:seed
   prod up -d --wait
   curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:39000/login
   ```

   `--profile tools` is load-bearing, not tidiness: `migrate` is a profiled
   service, and a plain `build` skips it silently, so `run` would migrate
   with the previous deploy's image. The seed is a faithful transcription of
   the reference resume, so the first deploy creates the `OWNER_EMAIL` user
   with real content and the Default cover letter; run again, it finds a
   user and does nothing. **Never pass it `--force` here** — that truncates
   every content table.

   The `curl` prints `200`. Open `https://<host>` and log in with
   `APP_PASSWORD`.

5. **Mint the agent's token** inside the migrate image, which already points
   at production's database:

   ```bash
   prod run --rm -T migrate npm run -s token:create -- --label laptop-agent
   ```

   Only the secret goes to stdout, and only this once. The migrate service
   has no `OWNER_EMAIL`, so the owner is the only user; add `--email` once
   there are more. `token:revoke` runs the same way.

6. **Connect the applying agent**, on the laptop, in a checkout that has
   `agent/`:

   ```bash
   git submodule update --init agent/career-ops
   cp agent/.env.example agent/.env    # then fill it in
   cd agent && ./claude.sh
   ```

   `agent/.env` takes `RESUMIX_MCP_URL=https://<host>/api/mcp`, the token as
   `RESUMIX_MCP_TOKEN`, and an absolute `CAREER_OPS_DATA_DIR`. In the session,
   `/mcp` lists `resumix` as connected.

## Every deploy after that

Always in this order, one command at a time, stopping at the first failure.
The running app keeps serving until the last command swaps it.

```bash
cd ~/.resumix/src
git fetch --prune origin
git checkout main && git reset --hard origin/main

prod --profile tools build
prod up -d --wait db

f=~/.resumix/backups/$(date +%Y%m%d-%H%M%S).sql
prod exec -T db pg_dump -U resumix resumix > "$f" && chmod 600 "$f"

prod run --rm migrate
comm -23 <(ls drizzle/*.sql | xargs -n1 basename | sort) \
  <(prod exec -T db psql -U resumix -d resumix -tAc 'select filename from _migrations' | sort)

prod up -d --wait --remove-orphans
```

- **Hard reset, not merge.** The clone is deploy output, so "what is on the
  remote ref" is the only state it may be in. A merge could leave
  production sitting on a conflict. To deploy another ref, put it where
  `main` is.
- **Back up before migrating.** Migrations only go forward; the dump is the
  way back.
- **The `comm` must print nothing.** It compares the tree's
  `drizzle/*.sql` with the database's `_migrations`, rather than asking the
  migrate container what is pending, because an image that predates a
  migration does not carry the file and would answer "nothing pending"
  quite honestly. It sits before the swap because code shipped ahead of its
  schema does not fail during the deploy; it fails later, as 500s from the
  first query that touches a missing column.
- Nothing prunes the backups.
  `ls -1t ~/.resumix/backups/*.sql | tail -n +21 | xargs rm -f` keeps the
  newest 20.

## Operating it

```bash
prod ps
prod logs -f --tail=100 [service]
prod stop        # sticky until the next `prod up -d`
```

## Backups and restore

Each dump is plain `pg_dump` output of a small database, and it includes the
`resume_pdf` snapshots — which is the point, since those bytes are not
reproducible from content once a template or bullet changes (D-011). Take
one outside a deploy with the two backup lines above. They live on the VM's
own disk, so losing the VM loses them: copy them off it.

A dump restores only into an empty schema:

```bash
prod stop app
prod exec -T db psql -U resumix -d resumix -c 'drop schema public cascade; create schema public;'
prod exec -T db psql -U resumix -d resumix -v ON_ERROR_STOP=1 < ~/.resumix/backups/<timestamp>.sql
prod up -d --wait
```

If the dump predates the deployed commit's migrations, run
`prod run --rm migrate` before the last line.

## Limits worth knowing

- **Single-user in practice.** The schema is multi-user but the only
  implemented login is the shared password, which signs in as `OWNER_EMAIL`.
  See "A note on multi-user" in the appendix.
- **One VM, one disk.** No replica, and the backups share its disk.
- **Builds run on the VM.** There is no registry; every deploy builds from
  the clone.
- **`npm run deploy:prod` does not deploy it.** That script pulls only
  `origin/main`, and its permission check calls `stat -f`, which GNU
  coreutils reads as a filesystem query, so it fails on Linux. It deploys
  the laptop instance below.

## The laptop instance

`npm run deploy:prod` (`scripts/deploy-prod.sh`) deploys an earlier, local
instance on Chris's laptop (D-031): its own clone at `~/.resumix/src` there,
loopback ports 39000 / 39432 / 39080, always `origin/main`, macOS only. It
holds the real content entered before the VM, and it is as off-limits to
agents as the VM: the script exits when `CLAUDECODE` is set, and
`.claude/settings.json` denies the script, the prod compose file and
`~/.resumix/`. Its first run bootstraps `~/.resumix` and stops for the
secrets; after that it takes `deploy`, `status`, `logs`, `stop` or `backup`.

## Troubleshooting

**`TypeError: Invalid URL` from the app or `migrate`** — `POSTGRES_PASSWORD`
contains a `/` or another character a URL cannot carry unescaped. Postgres
takes its password from the variable only when the volume is first created,
so editing `prod.env` alone does not fix it. With no data yet, `prod down -v`
and deploy again. With data, change it in the database first
(`prod exec db psql -U resumix -d resumix -c "alter user resumix password '<hex>'"`),
then in `prod.env`.

**The build is killed with exit 137** — the VM ran out of memory, almost
always in `next build`. Add swap or memory and build again.

**The HTTPS URL answers 502** — the front end cannot reach
`127.0.0.1:39000`. It has to run on the VM host or tunnel into it; a proxy
in its own container needs host networking. `curl` against that address on
the VM tells the two apart.

**`/api/mcp` answers 401** — production does not know the token: it was
minted against another database (`npm run token:create` on a laptop mints
against dev), revoked, or mistyped in `agent/.env`.

**The `comm` prints a filename** — the migrate image is stale. Run
`prod run --rm --build migrate` and check again.

**Production and development disagree about the schema** — they are
separate databases with separate `_migrations` tables, which is intended.
Production only ever applies what is in the ref its clone is at.

---

# Appendix: the cloud path, not taken

Everything below describes deploying to **Supabase + Fly.io + Vercel**. It
was written and checked for internal consistency against the code, but it has
never been executed and is not the current deployment (D-051). It is kept
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
