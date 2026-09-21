#!/usr/bin/env bash
#
# Deploy the production instance. `npm run deploy:prod`.
#
# Production is a second, fully separate copy of Resumix running on this same
# machine: its own clone, its own Postgres volume, its own images, its own
# ports (39000/39432/39080). It holds real resume content, it is never
# seeded with --force, and no development command touches it (D-031).
#
# The deploy is: pull main → build → back up → migrate → swap. Everything
# here is idempotent; running it twice with no upstream changes rebuilds the
# same images and reports "already up to date".
#
# Everything prod owns lives under ~/.resumix, outside the repo:
#
#   ~/.resumix/prod.env      secrets (chmod 600, never committed)
#   ~/.resumix/src/          the clone this deploys from, always at origin/main
#   ~/.resumix/backups/      a pg_dump taken before every migration
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Agents do not deploy.
#
# The rule is in CLAUDE.md, but prose is not a control. Claude Code exports
# CLAUDECODE=1 into every command it runs, so this is the rule in executable
# form: an agent that tries this stops here, whatever it was told.
# ---------------------------------------------------------------------------
if [[ -n "${CLAUDECODE:-}" ]]; then
  cat >&2 <<'EOF'
refusing to deploy: CLAUDECODE is set.

Production holds real resume content and is off-limits to agents (CLAUDE.md,
"Production is not yours"). Test against the development environment
instead: docker compose up -d db latex && npm run dev.

A human should run `npm run deploy:prod` in their own shell.
EOF
  exit 1
fi

PROD_HOME="${RESUMIX_PROD_HOME:-$HOME/.resumix}"
SRC="$PROD_HOME/src"
ENV_FILE="$PROD_HOME/prod.env"
BACKUPS="$PROD_HOME/backups"
BACKUPS_KEPT=20

COMPOSE_FILE="docker-compose.prod.yml"
APP_URL="http://localhost:39000"

# Resolved before we cd anywhere, so the example file and the origin URL come
# from the checkout the developer invoked this from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed"
  docker info >/dev/null 2>&1 || die "docker is not running — start Docker Desktop"
}

# First run bootstraps the clone and drops an env template, then stops. It
# deliberately does not deploy on the same invocation: there are no secrets
# yet, and a half-configured production instance is worse than none.
bootstrap() {
  local origin
  origin="$(git -C "$REPO_ROOT" remote get-url origin)"

  mkdir -p "$PROD_HOME" "$BACKUPS"
  chmod 700 "$PROD_HOME"

  if [[ ! -d "$SRC/.git" ]]; then
    say "First run — cloning $origin into $SRC"
    git clone "$origin" "$SRC"
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$REPO_ROOT/prod.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    cat <<EOF

Wrote a template to $ENV_FILE.

Fill in the four secrets it lists, then run this again. Two of them want a
long random string — generate each separately:

    openssl rand -base64 32

EOF
    exit 1
  fi
}

require_env() {
  [[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE"

  # A world-readable file of production secrets is worth failing over.
  local perms
  perms="$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")"
  if [[ "$perms" != "600" ]]; then
    die "$ENV_FILE is mode $perms; run: chmod 600 $ENV_FILE"
  fi

  # Checked here rather than left to compose's `:?` so all four missing keys
  # are reported at once, before anything has been built or started.
  local missing=()
  local key
  for key in POSTGRES_PASSWORD APP_PASSWORD AUTH_SECRET LATEX_SERVICE_TOKEN OWNER_EMAIL; do
    grep -qE "^${key}=.+" "$ENV_FILE" || missing+=("$key")
  done
  if (( ${#missing[@]} > 0 )); then
    die "$ENV_FILE is missing a value for: ${missing[*]}"
  fi
}

# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

pull_main() {
  say "Fetching origin/main"
  local before after
  before="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo 'none')"

  git -C "$SRC" fetch --prune origin
  git -C "$SRC" checkout main
  # Hard reset, not merge: this clone is deploy output, never edited by hand,
  # so "what is on origin/main" is the only state it is allowed to be in. A
  # merge here could leave prod sitting on a conflict.
  git -C "$SRC" reset --hard origin/main

  after="$(git -C "$SRC" rev-parse --short HEAD)"
  if [[ "$before" == "$after" ]]; then
    echo "already at $after (no upstream changes)"
  else
    echo "$before -> $after"
    git -C "$SRC" --no-pager log --oneline "$before..$after" 2>/dev/null || true
  fi
}

build_images() {
  say "Building images from $(git -C "$SRC" rev-parse --short HEAD)"
  compose build
}

start_db() {
  say "Starting the database"
  compose up -d db
  # `up -d` returns once the container is running, not once Postgres is
  # accepting connections; the migration would race it.
  local i
  for i in $(seq 1 60); do
    if compose exec -T db pg_isready -U resumix -d resumix >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die "database did not become ready in 60s — check: npm run deploy:prod logs"
}

backup_db() {
  # Nothing to preserve before the very first migration.
  local tables
  tables="$(compose exec -T db psql -U resumix -d resumix -tAc \
    "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0)"
  if [[ "${tables//[[:space:]]/}" == "0" ]]; then
    say "Empty database — nothing to back up"
    return 0
  fi

  mkdir -p "$BACKUPS"
  local dest="$BACKUPS/$(date +%Y%m%d-%H%M%S).sql"
  say "Backing up to $dest"
  compose exec -T db pg_dump -U resumix resumix > "$dest"
  chmod 600 "$dest"

  # Keep the tail bounded; these are full dumps of the same small database.
  ls -1t "$BACKUPS"/*.sql 2>/dev/null | tail -n "+$((BACKUPS_KEPT + 1))" | while read -r old; do
    rm -f "$old"
  done
}

migrate_db() {
  say "Applying migrations"
  compose run --rm migrate

  # Idempotent by design: scripts/seed.ts is a no-op once a user exists, so
  # this only does anything on the first deploy. --force is never passed
  # here and must never be — it TRUNCATEs every content table, which against
  # production means the real resume.
  say "Ensuring an owner exists (no-op after the first deploy)"
  compose run --rm migrate npm run db:seed
}

swap() {
  say "Starting the app"
  compose up -d --remove-orphans

  local i
  for i in $(seq 1 60); do
    if curl -sf -o /dev/null "$APP_URL/login"; then
      say "Live at $APP_URL"
      compose ps
      return 0
    fi
    sleep 1
  done
  die "app did not answer on $APP_URL in 60s — check: npm run deploy:prod logs"
}

# ---------------------------------------------------------------------------
# Subcommands. `deploy` is the point; the rest are the minimum needed to
# operate the thing without memorising the compose invocation.
# ---------------------------------------------------------------------------

cmd_deploy() {
  require_docker
  bootstrap
  require_env
  pull_main
  cd "$SRC"
  build_images
  start_db
  backup_db
  migrate_db
  swap
}

# All of these still need $ENV_FILE: compose interpolates the prod.env
# variables (and their `:?` guards) even for `ps`.
cmd_status() { require_docker; require_env; cd "$SRC"; compose ps; }
cmd_logs()   { require_docker; require_env; cd "$SRC"; compose logs -f --tail=100 "$@"; }
cmd_stop()   { require_docker; require_env; cd "$SRC"; compose stop; }
cmd_backup() { require_docker; require_env; cd "$SRC"; start_db; backup_db; }

case "${1:-deploy}" in
  deploy) shift || true; cmd_deploy ;;
  status) shift; cmd_status ;;
  logs)   shift; cmd_logs "$@" ;;
  stop)   shift; cmd_stop ;;
  backup) shift; cmd_backup ;;
  *) die "unknown command '$1' (deploy | status | logs | stop | backup)" ;;
esac
