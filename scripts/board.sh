#!/usr/bin/env bash
#
# Move an issue's card on the Projects v2 board, and find the issues a PR closes.
#
# One implementation, used from two places: agents run it by hand for the
# transitions only they know about (-> Planning, -> Blocked), and
# .github/workflows/board.yml runs it for the ones inferable from git events.
# Keeping it in one file is why the board can never disagree with itself.
#
# Projects v2 is GraphQL-only -- there is no REST endpoint for setting a
# single-select field -- so this is four round trips, not one. It needs a token
# with `project` scope, which the default Actions GITHUB_TOKEN does not have:
# see .claude/rules/github.md.
#
# Usage:
#   scripts/board.sh move <issue-number> <status>
#   scripts/board.sh pr-issues <pr-number>

set -euo pipefail

OWNER="${RESUMIX_PROJECT_OWNER:-chpy04}"
REPO="${RESUMIX_REPO:-resumix}"
PROJECT="${RESUMIX_PROJECT_NUMBER:-1}"

die() {
  echo "board: $*" >&2
  exit 1
}

# Resolve the project node id and the Status field's id plus the option id for
# the requested status name. Fails loudly on an unknown status rather than
# silently leaving the card where it was -- a card that quietly did not move is
# worse than no board at all.
move() {
  local issue="$1" status="$2"

  local project_json
  project_json=$(gh api graphql -f owner="$OWNER" -F number="$PROJECT" -f query='
    query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          id
          field(name: "Status") {
            ... on ProjectV2SingleSelectField { id options { id name } }
          }
        }
      }
    }') || die "cannot read project $PROJECT (token may be missing the project scope)"

  local project_id field_id option_id
  project_id=$(jq -r '.data.user.projectV2.id' <<<"$project_json")
  field_id=$(jq -r '.data.user.projectV2.field.id' <<<"$project_json")
  option_id=$(jq -r --arg s "$status" \
    '.data.user.projectV2.field.options[] | select(.name == $s) | .id' <<<"$project_json")

  [ -n "$option_id" ] || die "no status named '$status' on the board"

  # The issue may not be on the board yet (it is added automatically on open,
  # but an issue filed before the board existed would not be).
  local item_id
  item_id=$(gh api graphql -f owner="$OWNER" -f repo="$REPO" -F issue="$issue" -f query='
    query($owner: String!, $repo: String!, $issue: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $issue) {
          id
          projectItems(first: 20) { nodes { id project { id } } }
        }
      }
    }' --jq ".data.repository.issue.projectItems.nodes[] | select(.project.id == \"$project_id\") | .id")

  if [ -z "$item_id" ]; then
    local content_id
    content_id=$(gh api graphql -f owner="$OWNER" -f repo="$REPO" -F issue="$issue" \
      -f query='query($owner: String!, $repo: String!, $issue: Int!) {
        repository(owner: $owner, name: $repo) { issue(number: $issue) { id } }
      }' --jq '.data.repository.issue.id')
    [ -n "$content_id" ] || die "issue #$issue not found"
    item_id=$(gh api graphql -f project="$project_id" -f content="$content_id" \
      -f query='mutation($project: ID!, $content: ID!) {
        addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
      }' --jq '.data.addProjectV2ItemById.item.id')
  fi

  gh api graphql -f project="$project_id" -f item="$item_id" -f field="$field_id" -f option="$option_id" \
    -f query='mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project, itemId: $item, fieldId: $field,
        value: { singleSelectOptionId: $option }
      }) { projectV2Item { id } }
    }' >/dev/null

  echo "board: #$issue -> $status"
}

# The issues a PR closes, via the `Closes #n` links GitHub itself parses --
# not a regex over the body, so it agrees with what GitHub will actually close.
pr_issues() {
  gh api graphql -f owner="$OWNER" -f repo="$REPO" -F pr="$1" -f query='
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          closingIssuesReferences(first: 20) { nodes { number } }
        }
      }
    }' --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'
}

case "${1:-}" in
  move) [ $# -eq 3 ] || die "usage: board.sh move <issue-number> <status>"; move "$2" "$3" ;;
  pr-issues) [ $# -eq 2 ] || die "usage: board.sh pr-issues <pr-number>"; pr_issues "$2" ;;
  *) die "usage: board.sh move <issue-number> <status> | board.sh pr-issues <pr-number>" ;;
esac
