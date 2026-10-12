#!/usr/bin/env bash
#
# Start the Claude that applies to jobs. Run `./claude.sh` from agent/; any
# arguments are passed through to `claude`.
#
# This is the only supported way in (D-038). Claude Code reads no .env file of
# its own, and agent/.mcp.json takes the production URL and token from the
# environment, so a bare `claude` here would start with the Resumix MCP
# unconfigured. `--add-dir career-ops` is what lists the career-ops skills at
# startup; a skill in a subdirectory is not discovered otherwise.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Agents do not start this.
#
# Every Resumix call this session makes goes to production, and the Claude
# that builds Resumix never touches production (CLAUDE.md, "Production is not
# yours"). Claude Code exports CLAUDECODE=1 into every command it runs, so
# this is that rule in executable form, as in scripts/deploy-prod.sh.
# ---------------------------------------------------------------------------
if [[ -n "${CLAUDECODE:-}" ]]; then
  cat >&2 <<'EOF'
refusing to start: CLAUDECODE is set.

agent/ is the workspace of the Claude that applies to jobs, and everything it
does reaches production (CLAUDE.md, "Production is not yours"). The Claude
that builds Resumix works at the repo root against the dev stack instead.

A human should run ./claude.sh in their own shell.
EOF
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")"

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f .env ]] || die "agent/.env is missing. Copy agent/.env.example to agent/.env and fill it in."

[[ -f career-ops/AGENTS.md ]] ||
  die "agent/career-ops is not checked out. Run: git submodule update --init"

# Only .env may supply these. A stale value exported in the calling shell
# would otherwise pass the check below and point the session somewhere else.
unset RESUMIX_MCP_URL RESUMIX_MCP_TOKEN CAREER_OPS_DATA_DIR

set -a
# shellcheck source=/dev/null
. ./.env
set +a

for var in RESUMIX_MCP_URL RESUMIX_MCP_TOKEN CAREER_OPS_DATA_DIR; do
  [[ -n "${!var:-}" ]] || die "$var is empty in agent/.env. See agent/.env.example."
done

exec claude --add-dir career-ops "$@"
