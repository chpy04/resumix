# Deployment

Production is a **cloud VM that runs Docker and nothing else**. It has its
own clone, its own Postgres volume and its own images; it holds real resume
content; and it is deployed by hand, with plain `docker compose` run from
`prod/` in that clone (D-053). HTTPS in front of it is not part of this repo
(D-051).

The appendix at the bottom describes the Vercel + Fly + Supabase path that
was written, validated, and not taken.

Everything production has is in one folder:

```
prod/docker-compose.yml   the whole stack, and the deploy order
prod/.env                 secrets, mode 600, gitignored; template in prod/.env.example
prod/backups/             a pg_dump from every `up`, the newest 20, gitignored
prod/mint-token           mints the agent's token and prints how to connect it
```

Compose reads `prod/.env` by itself because of its name, so every command
below is plain `docker compose`, run from `prod/`.

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
| source   | this checkout, any branch | a clone on the VM, at the deployed ref            |
| app      | `next dev` on the host    | `resumix-app:prod` container                      |
| database | volume `resumix_pgdata`   | volume `resumix-prod_pgdata`                      |
| compose  | `docker-compose.yml`      | `prod/docker-compose.yml`, project `resumix-prod` |
| web      | 3000 (e2e 3100)           | `127.0.0.1:39000`, behind HTTPS                   |
| postgres | 5433                      | `127.0.0.1:39432`                                 |
| latex    | 8080                      | `127.0.0.1:39080`                                 |
| secrets  | `.env`                    | `prod/.env` in the VM's clone                     |
| auth     | `dev` — no login screen   | `password`                                        |
| seeding  | `--force`, constantly     | on the first `up` only, never `--force`           |

The project name is what owns the volume, so it is what carries the data
from one deploy to the next. Never change `name: resumix-prod`.

## HTTPS is in front, and not in this repo

`prod/docker-compose.yml` binds every port to `127.0.0.1`, so the app is
reachable only at `127.0.0.1:39000` on the VM itself, and Postgres and the
LaTeX sidecar not at all from off it. Whatever terminates HTTPS runs on the
VM host, or tunnels into it, and forwards to that address. The repo carries
no proxy, certificate or DNS configuration, and nothing reaches production
over plain HTTP:

- The browser uses `https://<host>`, which is `PUBLIC_URL` in `prod/.env`.
- The applying agent's `RESUMIX_MCP_URL` is `https://<host>/api/mcp`.
  `./mint-token` builds it from `PUBLIC_URL`. Apply packets' file paths
  resolve against it (D-050), so there is no separate base URL to keep in
  step.
- `/api/auth` has no rate limit, so on a public URL `APP_PASSWORD` is the
  whole gate on the UI. Make it long and random.

Never forward 39432 or 39080. The database has only its password, and the
sidecar runs `pdflatex` on whatever it is handed (`services/latex/README.md`).

## Agents do not deploy

Only Chris reaches the VM. Agents at the repo root are never told where it
is: its URL and credentials exist only in `prod/.env` on the VM and in
`agent/.env`, which `.claude/settings.json` denies, so `CLAUDE.md` says
nothing about production at all (D-052). The laptop, where the agents work,
is fenced in code as well: `prod/mint-token`, `agent/connect.sh` and
`agent/claude.sh` refuse when `CLAUDECODE` is set, and the settings deny
`prod/.env`, `prod/backups/`, the scripts and `~/.resumix/`.

## What `up` does

`docker compose up -d --build` is the whole deploy. The services depend on
each other in the deploy's order, so compose runs it every time:

1. **`db`** starts and becomes healthy.
2. **`backup`** dumps the database to `prod/backups/<UTC time>.sql` and
   exits, keeping the newest 20. Migrations only go forward; the dump is
   the way back. It runs on the first `up` too, where it dumps an empty
   schema.
3. **`migrate`** applies `drizzle/*.sql`, then runs the seed, and exits. The
   seed is a no-op once any user exists, so it does something only on the
   first `up`.
4. **`app`** starts, once `migrate` has exited 0 and `latex` is healthy.

Compose recreates every changed container before it starts any, so a
deploy stops the old app first and is down for the few seconds the backup
and migrations take. A step that fails stops `up` there and leaves the app
stopped until an `up` succeeds, so new code never runs against an old
schema. `docker compose logs backup migrate` says why.

Build the whole stack, never one service. `migrate` and `app` are built
from the same commit only when they are built together, which `build` and
`up --build` always do; `docker compose build app` alone would leave the
migrations a deploy behind the code, and that fails later, as 500s from the
first query to touch a missing column.

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
   git clone --branch main <repo-url> resumix
   cd resumix/prod
   ```

2. **Write the secrets.**

   ```bash
   cp .env.example .env && chmod 600 .env
   ```

   Six are required. Compose refuses to start without any of the first
   five, and `./mint-token` without the sixth:

   | Variable              | What it is                                                |
   | --------------------- | --------------------------------------------------------- |
   | `POSTGRES_PASSWORD`   | production database password                              |
   | `APP_PASSWORD`        | what you type at the login screen                         |
   | `AUTH_SECRET`         | signs the session token — must differ from `APP_PASSWORD` |
   | `LATEX_SERVICE_TOKEN` | shared secret the app presents to the sidecar             |
   | `OWNER_EMAIL`         | which user the password gate signs in as                  |
   | `PUBLIC_URL`          | the `https://` address you open Resumix at, with no path  |

   Set `SEED_USER_NAME` as well. Left blank, compose passes it as an empty
   string, and the seed stores that instead of its default.

   Generate each random value separately with `openssl rand -hex 32`. **Hex,
   not base64:** `POSTGRES_PASSWORD` is spliced unescaped into the app's
   `DATABASE_URL`, and a `/` from base64 makes that URL unparseable. Compose
   also expands `$` in unquoted values, so single-quote an `APP_PASSWORD`
   that contains one. You never write a `DATABASE_URL` yourself:
   `prod/docker-compose.yml` builds it against the compose network, so no
   line in the env file can point production at another database.

3. **Start it.**

   ```bash
   docker compose up -d --build
   curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:39000/login
   ```

   The seed is a faithful transcription of the reference resume, so this
   first `up` creates the `OWNER_EMAIL` user with real content and the
   Default cover letter. The `curl` prints `200`. Open `https://<host>` and
   log in with `APP_PASSWORD`.

4. **Connect the applying agent.** On the VM:

   ```bash
   ./mint-token
   ```

   It prints the token, once, and the command that connects the agent to
   it. On the laptop, in a checkout that has `agent/`:

   ```bash
   git submodule update --init agent/career-ops   # once per checkout
   agent/connect.sh https://<host>/api/mcp rmx_…  # exactly as printed
   cd agent && ./claude.sh
   ```

   `agent/connect.sh` writes the URL and token into `agent/.env`, starting
   it from `agent/.env.example` if there is none and setting an empty
   `CAREER_OPS_DATA_DIR` to `agent/career-ops-data`. In the session, `/mcp`
   lists `resumix` as connected.

## Every deploy after that

```bash
cd resumix
git pull --ff-only
cd prod && docker compose up -d --build
```

- **Fast-forward only.** The clone is deploy output, never edited on the
  VM, so a pull always fast-forwards; one that refuses means something was
  edited by hand, and `git reset --hard origin/main` puts it back. A merge
  could leave production sitting on a conflict. To deploy another ref,
  check it out instead.
- **Never `git clean -x` here.** `prod/.env` and `prod/backups/` are
  ignored files in the clone, and it would delete both.
- Nothing else to remember: the backup and the migrations are part of `up`.

## Migrating by hand

`up` migrates on its own, so this is only for when you want the migration as
a step of its own, with the app down:

```bash
docker compose down
docker compose run --rm --build migrate
docker compose up -d --build
```

The middle command is the whole migration. It builds the migrate image from
the checkout, starts the database, takes a backup, applies `drizzle/*.sql`
and runs the seed, which does nothing once a user exists, then exits.
`--build` matters: without it, `run` uses the image from the last build,
which does not carry a migration pulled since. The `up` after it runs
`migrate` again, and it finds nothing to apply.

## Tokens for the agent

```bash
./mint-token [label]                                    # label defaults to laptop-agent
docker compose run --rm migrate npm run token:revoke -- <id>
```

`./mint-token` runs `npm run token:create` inside the migrate image, so the
token is minted against production's database and owned by `OWNER_EMAIL`.
The token's id, which `token:revoke` takes, is printed above it. Only a
hash is stored, so a lost token is replaced, never recovered: mint another
and revoke the old one. Both start what `migrate` depends on, so each takes
a backup first, as `up` does.

## Operating it

```bash
docker compose ps
docker compose logs -f --tail=100 [service]
docker compose stop        # sticky until the next `up`
docker compose down        # removes the containers; the volume stays
```

**Never `docker compose down -v`.** `-v` deletes `resumix-prod_pgdata`,
which is the production database.

## Backups and restore

Each dump is plain `pg_dump` output of a small database, and it includes the
`resume_pdf` snapshots — which is the point, since those bytes are not
reproducible from content once a template or bullet changes (D-011). Take
one outside a deploy with `docker compose run --rm backup`. Each file
belongs to whoever owns `prod/backups/`, mode 600. They live on the VM's
own disk, so losing the VM loses them: copy them off it.

A dump restores only into an empty schema:

```bash
docker compose stop app
docker compose exec -T db psql -U resumix -d resumix -c 'drop schema public cascade; create schema public;'
docker compose exec -T db psql -U resumix -d resumix -v ON_ERROR_STOP=1 < backups/<time>.sql
docker compose up -d
```

The last `up` backs up the restored database and applies any migration
newer than the dump, as every `up` does.

## Limits worth knowing

- **Single-user in practice.** The schema is multi-user but the only
  implemented login is the shared password, which signs in as `OWNER_EMAIL`.
  See "A note on multi-user" in the appendix.
- **One VM, one disk.** No replica, and the backups share its disk.
- **Builds run on the VM.** There is no registry; every deploy builds from
  the clone.

## The laptop instance

The earlier production on Chris's laptop (D-031) is the same compose
project, `resumix-prod`, on the same ports, with its own data in the
laptop's `resumix-prod_pgdata` volume and its own clone at `~/.resumix/src`.
`prod/` runs it too, from that clone and never from the checkout the agents
share: its secrets go at `~/.resumix/src/prod/.env`, and `docker compose`
runs from `~/.resumix/src/prod`. `.claude/settings.json` denies
`~/.resumix/`.

## Troubleshooting

**`TypeError: Invalid URL` from the app or `migrate`** — `POSTGRES_PASSWORD`
contains a `/` or another character a URL cannot carry unescaped. Postgres
takes its password from the variable only when the volume is first created,
so editing `prod/.env` alone does not fix it. With no data yet,
`docker compose down -v` and `up` again; that is the one time `-v` is
right. With data, change it in the database first
(`docker compose exec db psql -U resumix -d resumix -c "alter user resumix password '<hex>'"`),
then in `prod/.env`.

**`up` stops at `backup` or `migrate`** — `docker compose logs backup migrate`
shows the failing step, and the app stays stopped. Fix the cause and `up`
again; each migration runs in its own transaction, so the ones that applied
are recorded in `_migrations` and skipped. To serve the previous deploy in
the meantime, check out its commit and `docker compose up -d --build`.

**The build is killed with exit 137** — the VM ran out of memory, almost
always in `next build`. Add swap or memory and build again.

**The HTTPS URL answers 502** — the front end cannot reach
`127.0.0.1:39000`. It has to run on the VM host or tunnel into it; a proxy
in its own container needs host networking. `curl` against that address on
the VM tells the two apart.

**`/api/mcp` answers 401** — production does not know the token: it was
minted against another database (`npm run token:create` on a laptop mints
against dev), revoked, or mistyped in `agent/.env`. Run `./mint-token` on
the VM and the command it prints on the laptop.

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
