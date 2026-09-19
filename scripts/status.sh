#!/usr/bin/env bash
#
# Set an issue's lifecycle status, and find the issues a PR closes.
#
# Status lives in a `status:*` label on the issue itself (D-026). One
# implementation, used from two places: agents run it by hand for the
# transitions only they know about (-> planning, -> in-progress, -> blocked),
# and .github/workflows/status.yml runs it for the ones inferable from git
# events. Keeping it in one file is why the status can never disagree with
# itself.
#
# Labels, not a Projects v2 board, because a board is unreachable from a
# repo-scoped credential: Projects exists only as an *organization* permission
# on a fine-grained PAT, so a user-owned board needs a classic PAT with
# `project` scope -- which cannot be restricted to one repository. A label is
# an ordinary `Issues: write`, so CI's default GITHUB_TOKEN is enough and
# there is no secret to rotate or forget.
#
# Usage:
#   scripts/status.sh set <issue-number> <status>
#   scripts/status.sh get <issue-number>
#   scripts/status.sh pr-issues <pr-number>
#
# <status> is accepted in either dialect -- "In Progress" as the lifecycle
# table in CLAUDE.md writes it, or `in-progress` as the label spells it.

set -euo pipefail

REPO="${RESUMIX_REPO:-chpy04/resumix}"
PREFIX="status:"

# The seven the lifecycle defines. Load-bearing: an unknown status is a typo,
# and adding an unknown label via the API would have GitHub silently create it
# in a random colour rather than fail.
STATUSES=(backlog planning ready in-progress in-review blocked done)

die() {
  echo "status: $*" >&2
  exit 1
}

# "In Progress" / "in progress" / "in-progress" all mean status:in-progress.
normalise() {
  local s
  s=$(tr '[:upper:]' '[:lower:]' <<<"$1" | tr ' _' '-')
  s=${s#"$PREFIX"}
  for known in "${STATUSES[@]}"; do
    [ "$s" = "$known" ] && { echo "$PREFIX$s"; return; }
  done
  die "no status named '$1' (one of: ${STATUSES[*]})"
}

# The label set on an issue, filtered to ours.
current() {
  gh api "repos/$REPO/issues/$1/labels" --jq ".[].name | select(startswith(\"$PREFIX\"))"
}

# Exactly one status label at a time. Removing the old ones before adding the
# new one would leave the issue statusless if the add then failed, so the new
# label goes on first -- a moment wearing two is recoverable, wearing none is
# invisible.
set_status() {
  local issue="$1" want
  want=$(normalise "$2")

  gh api "repos/$REPO/labels/$want" >/dev/null 2>&1 ||
    die "the label '$want' does not exist in $REPO -- create it rather than letting the API invent one"

  gh api "repos/$REPO/issues/$issue/labels" -f "labels[]=$want" >/dev/null ||
    die "issue #$issue not found in $REPO"

  local stale
  stale=$(current "$issue" | grep -vFx "$want" || true)
  for label in $stale; do
    gh api -X DELETE "repos/$REPO/issues/$issue/labels/$label" >/dev/null
  done

  echo "status: #$issue -> $want"
}

get_status() {
  local found
  found=$(current "$1")
  [ -n "$found" ] || die "#$1 has no $PREFIX label"
  echo "$found"
}

# The issues a PR closes, via the `Closes #n` links GitHub itself parses --
# not a regex over the body, so it agrees with what GitHub will actually close.
pr_issues() {
  gh api graphql -f owner="${REPO%%/*}" -f repo="${REPO##*/}" -F pr="$1" -f query='
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          closingIssuesReferences(first: 20) { nodes { number } }
        }
      }
    }' --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'
}

case "${1:-}" in
  set) [ $# -eq 3 ] || die "usage: status.sh set <issue-number> <status>"; set_status "$2" "$3" ;;
  get) [ $# -eq 2 ] || die "usage: status.sh get <issue-number>"; get_status "$2" ;;
  pr-issues) [ $# -eq 2 ] || die "usage: status.sh pr-issues <pr-number>"; pr_issues "$2" ;;
  *) die "usage: status.sh set <issue-number> <status> | status.sh get <issue-number> | status.sh pr-issues <pr-number>" ;;
esac
