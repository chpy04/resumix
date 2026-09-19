#!/usr/bin/env bash
#
# Open one Claude terminal per open issue, on the skill that issue's status
# calls for.
#
# This is the unattended path of CLAUDE.md's lifecycle, driven from the
# outside: the three skills each take exactly one issue and deliberately
# refuse to scan the list, because "what gets worked on" is a human decision.
# This script *is* that decision, made once and in the open -- it reads every
# open issue, maps `status:*` to the one skill whose entry conditions that
# status satisfies, and starts an agent per match.
#
# There is no model in this loop. Every branch below is a label comparison or
# a timestamp comparison, so two runs against the same tracker state launch
# the same terminals. If it ever surprises you, `--dry-run` prints the whole
# decision table without touching Herdr.
#
#   status:backlog     -> /triage <n>      no plan exists yet
#   status:planning    -> /triage <n>      ONLY if feedback postdates the plan
#   status:ready       -> /implement <n>   a human approved the plan
#   status:in-review   -> /review-pr <pr>  the open PR that closes it
#   status:in-progress -> skip             an agent already claimed it
#   status:blocked     -> skip             waiting on a human decision
#
# `planning` is the subtle one. It means a plan is written and sitting at the
# human approval gate, which is not work an agent can advance -- except in the
# one case `/triage` names as re-planning, where a human has left feedback and
# somebody has to answer it. So a planning issue launches only when a comment
# is newer than the last edit to the body the plan lives in. Absent that, the
# issue is waiting on you and gets no terminal.
#
# Usage:
#   scripts/herd.sh [--dry-run] [--workspace <id>]
#
# Requires: gh (authenticated), jq, and a running Herdr server.

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
# skills themselves -- none of the three merges, force-pushes, or files an
# issue, and each stops at its phase boundary.
CLAUDE_ARGS=(--strict-mcp-config --permission-mode bypassPermissions)

REPO="${RESUMIX_REPO:-chpy04/resumix}"

# The skills worktree themselves (`../resumix-wt/<n>/`), so every agent starts
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

# One query for both halves of the mapping: the issues, and the open PRs whose
# `Closes #n` links tell an in-review issue which PR is its own. The links come
# from closingIssuesReferences -- what GitHub itself will close -- rather than
# a regex over the body, for the same reason `status.sh pr-issues` does.
fetch() {
  gh api graphql -f owner="${REPO%%/*}" -f repo="${REPO##*/}" -f query='
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        issues(states: OPEN, first: 100) {
          nodes {
            number
            title
            body
            createdAt
            lastEditedAt
            labels(first: 20) { nodes { name } }
            comments(last: 1) { nodes { createdAt } }
          }
        }
        pullRequests(states: OPEN, first: 100) {
          nodes {
            number
            isDraft
            closingIssuesReferences(first: 5) { nodes { number } }
          }
        }
      }
    }'
}

# The whole decision, in one place, as data. Emits TSV:
#   <issue>  run|skip  <skill>  <arg>  <reason>  <title>
#
# Skip rows carry "-" for skill and arg rather than "". Tab is an IFS
# whitespace character, so bash's `read` folds a run of them into one
# separator and an empty middle field would silently shift every later field
# one to the left.
#
# ISO 8601 timestamps are all UTC and fixed-width here, so `>` on the strings
# is a correct chronological compare and needs no date parsing.
DECIDE='
  .data.repository as $r
  | ([ $r.pullRequests.nodes[]
       | select(.isDraft | not) as $p
       | $p.closingIssuesReferences.nodes[]
       | { key: (.number | tostring), value: $p.number } ] | from_entries) as $prOf
  | $r.issues.nodes[]
  | . as $i
  | ([ .labels.nodes[].name ] | map(select(startswith("status:")))) as $labels
  | ($labels[0] // "" | ltrimstr("status:")) as $s
  | (.body | test("<!-- resumix:plan -->")) as $planned
  | (.lastEditedAt // .createdAt) as $bodyAt
  | (.comments.nodes[0].createdAt // "") as $commentAt
  | (if ($labels | length) == 0 then
       ["skip", "-", "-", "no status: label -- scripts/status.sh set \($i.number) backlog"]
     elif ($labels | length) > 1 then
       ["skip", "-", "-", "wears \($labels | join(" + ")) -- scripts/status.sh set \($i.number) <one>"]
     elif $s == "backlog" then
       ["run", "triage", ($i.number | tostring), "unplanned"]
     elif $s == "planning" then
       (if ($planned | not) then
          ["run", "triage", ($i.number | tostring), "status:planning with no plan in the body"]
        elif ($commentAt != "" and $commentAt > $bodyAt) then
          ["run", "triage", ($i.number | tostring), "feedback left since the plan"]
        else
          ["skip", "-", "-", "plan written, waiting on your approval"]
        end)
     elif $s == "ready" then
       ["run", "implement", ($i.number | tostring), "plan approved"]
     elif $s == "in-review" then
       ($prOf[$i.number | tostring] as $pr
        | if $pr == null then
            ["skip", "-", "-", "status:in-review but no open non-draft PR closes it"]
          else
            ["run", "review-pr", ($pr | tostring), "PR #\($pr)"]
          end)
     elif $s == "in-progress" then
       ["skip", "-", "-", "an agent already has it"]
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

launch() {
  local num="$1" skill="$2" arg="$3" label pane out
  label="#$num $skill"

  out=$(herdr_api herdr tab create \
    --workspace "$WORKSPACE" --cwd "$ROOT" --label "$label" --no-focus) ||
    { echo "  ! could not create a tab for #$num" >&2; return 1; }

  pane=$(jq -r '.result.root_pane.pane_id // empty' <<<"$out")
  [ -n "$pane" ] || { echo "  ! tab for #$num came back without a pane" >&2; return 1; }

  # Returns only once Herdr has detected Claude in that pane and considers it
  # ready for input, so the prompt below cannot race the agent's startup.
  herdr_api herdr agent start "issue-$num" --kind claude --pane "$pane" \
    -- "${CLAUDE_ARGS[@]}" >/dev/null ||
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
  elif launch "$num" "$skill" "$arg"; then
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
