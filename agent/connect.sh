#!/usr/bin/env bash
#
# Connect the applying agent to production: write the MCP URL and token that
# prod/mint-token printed into agent/.env (D-053). Chris runs it on the
# laptop, from the checkout, exactly as that script prints it:
#
#   agent/connect.sh https://<host>/api/mcp rmx_…
#
# With no agent/.env, it starts one from .env.example. In one that exists,
# only RESUMIX_MCP_URL and RESUMIX_MCP_TOKEN are replaced, and
# CAREER_OPS_DATA_DIR is filled in with agent/career-ops-data only while it
# is empty; every other line is kept as it is. It prints neither value.
#
# bash 3.2 and BSD awk: this runs on macOS's own bash.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Agents do not run this.
#
# It writes a production token where the applying Claude's MCP reads it
# (D-038). Claude Code exports CLAUDECODE=1 into every command it runs, as
# claude.sh checks too.
# ---------------------------------------------------------------------------
if [[ -n "${CLAUDECODE:-}" ]]; then
  cat >&2 <<'EOF'
refusing to run: CLAUDECODE is set.

This writes a production token into agent/.env (D-038). A human should run
the command prod/mint-token printed, in their own shell.
EOF
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

USAGE='usage: agent/connect.sh https://<host>/api/mcp rmx_<token>, as prod/mint-token prints it'
[[ $# -eq 2 ]] || die "$USAGE"

# claude.sh sources agent/.env as shell, so a value is checked down to
# characters that cannot mean anything there before it is written. The URL
# is production's endpoint, over https, ending in the path
# fetch-apply-files.sh finds the files beside.
[[ "$1" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/api/mcp$ ]] ||
  die "the URL is not production's MCP endpoint, https://<host>/api/mcp. $USAGE"
[[ "$2" =~ ^rmx_[A-Za-z0-9_-]{43}$ ]] ||
  die "the token is not an rmx_ token. $USAGE"
# The default data directory is written single-quoted, which a quote in the
# checkout's path would end early.
[[ "$here" != *\'* ]] || die "the checkout's path contains a single quote: $here"

env_file="$here/.env"
if [[ ! -f "$env_file" ]]; then
  [[ -f "$here/.env.example" ]] || die "$here/.env.example is missing."
  cp "$here/.env.example" "$env_file"
fi

# Next to the target, so the mv below is a rename and claude.sh never reads
# half a file. mktemp makes it mode 600, which the rename keeps.
tmp="$(mktemp "$here/.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

# Values go in through ENVIRON, since -v would interpret backslashes. Every
# line setting a key is replaced, a repeated one included, because the last
# one is the one claude.sh would see.
CONNECT_URL="$1" CONNECT_TOKEN="$2" CONNECT_DATA_DIR="'$here/career-ops-data'" awk '
  BEGIN {
    value["RESUMIX_MCP_URL"] = ENVIRON["CONNECT_URL"]
    value["RESUMIX_MCP_TOKEN"] = ENVIRON["CONNECT_TOKEN"]
  }
  /^RESUMIX_MCP_URL=/ || /^RESUMIX_MCP_TOKEN=/ {
    key = substr($0, 1, index($0, "=") - 1)
    print key "=" value[key]
    seen[key] = 1
    next
  }
  /^CAREER_OPS_DATA_DIR=/ {
    seen["CAREER_OPS_DATA_DIR"] = 1
    if ($0 ~ /^CAREER_OPS_DATA_DIR=(""|\047\047)?[[:space:]]*$/) {
      print "CAREER_OPS_DATA_DIR=" ENVIRON["CONNECT_DATA_DIR"]
      next
    }
  }
  { print }
  END {
    if (!seen["RESUMIX_MCP_URL"]) print "RESUMIX_MCP_URL=" value["RESUMIX_MCP_URL"]
    if (!seen["RESUMIX_MCP_TOKEN"]) print "RESUMIX_MCP_TOKEN=" value["RESUMIX_MCP_TOKEN"]
    if (!seen["CAREER_OPS_DATA_DIR"]) print "CAREER_OPS_DATA_DIR=" ENVIRON["CONNECT_DATA_DIR"]
  }
' "$env_file" >"$tmp"
mv "$tmp" "$env_file"

printf 'connected: %s\n' "$env_file"
if [[ ! -f "$here/career-ops/AGENTS.md" ]]; then
  printf 'career-ops is not checked out yet: git submodule update --init agent/career-ops\n'
fi
printf 'start the agent: cd agent && ./claude.sh\n'
