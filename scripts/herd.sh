#!/usr/bin/env bash
#
# Open one Claude terminal per backlog issue, running `/implement` on it.
#
# This is the unattended path, driven from the outside. `/implement` takes
# exactly one issue and deliberately refuses to scan the list, because "what
# gets worked on" is a human decision. This script *is* that decision, made
# once and in the open: filing an issue into backlog is the go-ahead, and
# every backlog issue gets one agent that plans, builds, verifies and opens
# a PR in a single pass (D-036). The PR is where a human looks -- unless the
# issue is labelled `plan-first`, in which case the agent stops after drawing
# its plan on the Excalidraw board, and the board is where a human looks first.
#
# There is no model in this loop. Every branch below is a label comparison, so
# two runs against the same tracker state launch the same terminals. If it
# ever surprises you, `--dry-run` prints the whole decision table without
# touching Herdr.
#
#   status:backlog     -> /implement <n>   (with Excalidraw, if plan-first)
#   status:in-progress -> skip   an agent already claimed it
#   status:plan-review -> skip   its plan is on the board, waiting on you
#   status:in-review   -> skip   a PR is open; that is yours to review
#   status:blocked     -> skip   waiting on a human decision
#
# So an issue you are not ready to hand over should not sit in backlog --
# set it to blocked (`scripts/status.sh set <n> blocked`) until it is, or
# label it `plan-first` if what you want is to see the approach before the
# code. Approving a plan is moving its issue back to backlog; close the
# planning agent's tab first, or this script will leave it alone.
#
# Usage:
#   scripts/herd.sh [--dry-run] [--workspace <id>]
#
# Requires: gh (authenticated), jq, a running Herdr server, and -- for
# plan-first issues only -- an `excalidraw` server in ~/.claude.json.

set -euo pipefail

# Native flags handed to each `claude`, after Herdr's own arguments.
#
# --strict-mcp-config is not optional. A fresh claude in this repo stops at
# "New MCP server found in this project: excalidraw" and waits, so `agent
# start` returns agent_not_ready and the prompt is never delivered. These
# agents want git, gh and npm, never an MCP server, so the fix and the right
# configuration are the same thing.
#
# bypassPermissions is what makes "unattended" true: /implement's merge gate
# is `npm run verify`, and an agent that has to ask before running bash has
# not been launched, it has been parked. The blast radius is bounded by the
# skill itself -- it never merges, force-pushes or files an issue, and it
# stops at the PR.
CLAUDE_ARGS=(--strict-mcp-config --permission-mode bypassPermissions)

# The one exception to "never an MCP server": a plan-first agent draws its
# plan on the Excalidraw board, so it gets exactly that server and nothing
# else. --mcp-config, unlike the user-scoped entry it is copied from, loads
# without the approval prompt that --strict-mcp-config exists to avoid. The
# entry carries its Authorization header, so the copy is private to you, like
# ~/.claude.json itself, and is rewritten on every run rather than kept in
# sync.
MCP_CONFIG="${XDG_CACHE_HOME:-$HOME/.cache}/resumix/herd-mcp.json"

REPO="${RESUMIX_REPO:-chpy04/resumix}"

# The skill worktrees itself (`../resumix-wt/<n>/`), so every agent starts
# in the main checkout and branches from there. Derived from this script
# rather than $PWD so the script works when run from anywhere.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

DRY_RUN=0
WORKSPACE=""

die() {
  echo "herd: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --workspace) [ $# -ge 2 ] || die "--workspace needs an id"; WORKSPACE="$2"; shift 2 ;;
    -h|--help) awk 'NR>1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument '$1' (usage: herd.sh [--dry-run] [--workspace <id>])" ;;
  esac
done

for tool in gh jq herdr; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not on PATH"
done

# Herdr's CLI reports server errors as JSON with an `.error` key, and does not
# reliably use a non-zero exit status to do it (`agent get <missing>` exits 0).
# So every call goes through here and the JSON is what decides.
herdr_api() {
  local out rc=0
  out=$("$@" 2>&1) || rc=$?
  local err
  err=$(jq -r '.error.message // empty' <<<"$out" 2>/dev/null || true)
  if [ -n "$err" ]; then
    echo "$err" >&2
    return 1
  fi
  [ "$rc" -eq 0 ] || { echo "$out" >&2; return 1; }
  printf '%s' "$out"
}

fetch() {
  gh issue list --repo "$REPO" --state open --limit 200 --json number,title,labels
}

# The whole decision, in one place, as data. Emits TSV:
#   <issue>  run|skip  <skill>  <arg>  <reason>  <title>
#
# Skip rows carry "-" for skill and arg rather than "". Tab is an IFS
# whitespace character, so bash's `read` folds a run of them into one
# separator and an empty middle field would silently shift every later field
# one to the left.
DECIDE='
  .[]
  | . as $i
  | ([ .labels[].name ] | map(select(startswith("status:")))) as $labels
  | ($labels[0] // "" | ltrimstr("status:")) as $s
  | (if ($labels | length) == 0 then
       ["skip", "-", "-", "no status: label -- scripts/status.sh set \($i.number) backlog"]
     elif ($labels | length) > 1 then
       ["skip", "-", "-", "wears \($labels | join(" + ")) -- scripts/status.sh set \($i.number) <one>"]
     elif $s == "backlog" then
       ["run", "implement", ($i.number | tostring),
        (if any($i.labels[]; .name == "plan-first") then "plan-first" else "backlog" end)]
     elif $s == "in-progress" then
       ["skip", "-", "-", "an agent already has it"]
     elif $s == "plan-review" then
       ["skip", "-", "-", "plan on the board, waiting on your review"]
     elif $s == "in-review" then
       ["skip", "-", "-", "PR open, waiting on your review"]
     elif $s == "blocked" then
       ["skip", "-", "-", "waiting on a human decision"]
     else
       ["skip", "-", "-", "status:\($s)"]
     end) as [$action, $skill, $arg, $reason]
  | [ ($i.number | tostring), $action, $skill, $arg, $reason, $i.title ] | @tsv
'

# Where the tabs land. The calling pane's workspace is the useful default --
# you run this from the workspace you are working the repo in.
if [ -z "$WORKSPACE" ]; then
  WORKSPACE="${HERDR_WORKSPACE_ID:-}"
fi
if [ -z "$WORKSPACE" ]; then
  WORKSPACE=$(herdr_api herdr workspace list | jq -r '.result.workspaces[0].workspace_id // empty') ||
    die "cannot reach the Herdr server -- is it running?"
  [ -n "$WORKSPACE" ] || die "no Herdr workspace to put tabs in"
fi

# Idempotence, so the script is safe to re-run as the tracker moves. Keyed on
# the tab rather than the agent: an agent's name is released the moment it
# exits, but the tab stays until you close it -- and a finished agent's output
# is exactly the thing you have not read yet. Closing the tab is what says
# "done with this one", and only then does a rerun open it again.
existing=$(herdr_api herdr tab list --workspace "$WORKSPACE" | jq -r '.result.tabs[].label // empty') ||
  die "cannot list tabs in workspace $WORKSPACE"

has_tab() {
  grep -q "^#$1 " <<<"$existing"
}

# Writes the Excalidraw-only MCP config once, the first time a plan-first
# issue needs it. Fails that one launch, not the run, if there is no server
# to copy.
excalidraw_config() {
  [ -n "${MCP_CONFIG_WRITTEN:-}" ] && return 0
  local server
  server=$(jq -c '.mcpServers.excalidraw // empty' "$HOME/.claude.json" 2>/dev/null) || server=""
  [ -n "$server" ] || { echo "  ! no excalidraw server in ~/.claude.json" >&2; return 1; }
  mkdir -p "$(dirname "$MCP_CONFIG")"
  (umask 077 && jq -n --argjson s "$server" '{mcpServers: {excalidraw: $s}}' >"$MCP_CONFIG")
  MCP_CONFIG_WRITTEN=1
}

launch() {
  local num="$1" skill="$2" arg="$3" reason="$4" label pane out
  local args=("${CLAUDE_ARGS[@]}")
  label="#$num $skill"

  if [ "$reason" = "plan-first" ]; then
    excalidraw_config || { echo "  ! cannot give #$num the Excalidraw board" >&2; return 1; }
    args+=(--mcp-config "$MCP_CONFIG")
  fi

  out=$(herdr_api herdr tab create \
    --workspace "$WORKSPACE" --cwd "$ROOT" --label "$label" --no-focus) ||
    { echo "  ! could not create a tab for #$num" >&2; return 1; }

  pane=$(jq -r '.result.root_pane.pane_id // empty' <<<"$out")
  [ -n "$pane" ] || { echo "  ! tab for #$num came back without a pane" >&2; return 1; }

  # Returns only once Herdr has detected Claude in that pane and considers it
  # ready for input, so the prompt below cannot race the agent's startup.
  herdr_api herdr agent start "issue-$num" --kind claude --pane "$pane" \
    -- "${args[@]}" >/dev/null ||
    { echo "  ! claude did not come up in $pane for #$num" >&2; return 1; }

  herdr_api herdr agent prompt "issue-$num" "/$skill $arg" >/dev/null ||
    { echo "  ! could not send /$skill $arg to #$num" >&2; return 1; }

  echo "  $label  ->  /$skill $arg  ($pane)"
}

# Read the tracker before printing anything. Inside a process substitution a
# failing `gh` is invisible -- the loop reads nothing and the run cheerfully
# reports "0 would start", which is indistinguishable from an empty backlog.
plan=$(fetch | jq -r "$DECIDE") || die "could not read $REPO -- is gh authenticated?"

ran=0
failed=0
skipped=0
held=0

echo "herd: $REPO -> workspace $WORKSPACE"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "      (dry run -- nothing will be started)"
fi
echo

while IFS=$'\t' read -r num action skill arg reason title; do
  [ -n "$num" ] || continue

  if [ "$action" = "skip" ]; then
    printf -- '- #%-4s %-46.46s  %s\n' "$num" "$title" "$reason"
    skipped=$((skipped + 1))
    continue
  fi

  if has_tab "$num"; then
    printf -- '- #%-4s %-46.46s  %s\n' "$num" "$title" "tab already open -- close it to rerun"
    held=$((held + 1))
    continue
  fi

  printf -- '+ #%-4s %-46.46s  /%s %s (%s)\n' "$num" "$title" "$skill" "$arg" "$reason"
  if [ "$DRY_RUN" -eq 1 ]; then
    ran=$((ran + 1))
  elif launch "$num" "$skill" "$arg" "$reason"; then
    ran=$((ran + 1))
  else
    # One issue failing to launch is not a reason to abandon the rest.
    failed=$((failed + 1))
  fi
done <<<"$plan"

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "herd: $ran would start, $held already open, $skipped left alone"
else
  summary="herd: $ran started, $held already open, $skipped left alone"
  [ "$failed" -eq 0 ] || summary="$summary, $failed FAILED"
  echo "$summary"
  [ "$failed" -eq 0 ] || exit 1
fi
