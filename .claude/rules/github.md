---
paths:
  - '.github/**'
  - 'scripts/status.sh'
---

# GitHub: issues, status, and PRs

The lifecycle every task follows is in `CLAUDE.md`. This file is the
mechanical half — the commands, and the conventions for the plumbing itself.

## Status is a label

An issue's lifecycle state is a `status:*` label on the issue itself, and
there are exactly seven:

`status:backlog` · `status:planning` · `status:ready` · `status:in-progress` ·
`status:in-review` · `status:blocked` · `status:done`

**An issue wears exactly one.** `scripts/status.sh` is what enforces that —
it adds the new label before stripping the old ones, because an issue briefly
wearing two is recoverable and an issue wearing none is invisible. Never add
or remove a `status:` label by hand or through `gh issue edit`; that is how an
issue ends up in two states at once.

`status:ready` and `status:in-progress` look redundant and are not:
`ready` means a human approved the plan, `in-progress` means an agent has
claimed the work. Merging them loses the ability to see a queue of
approved-but-unstarted work.

Those names are load-bearing. `status.sh` validates against the list above and
fails loudly on anything else, because adding an unrecognised label through the
API would have GitHub silently create it in a random colour rather than fail.

## Setting it

```bash
scripts/status.sh set <issue-number> "In Progress"   # or: in-progress
scripts/status.sh get <issue-number>
scripts/status.sh pr-issues <pr-number>              # the issues a PR closes
```

`set` takes either dialect — `"In Progress"` as `CLAUDE.md`'s lifecycle table
writes it, or `in-progress` as the label spells it.

Agents set `planning` (starting to plan), `in-progress` (claiming approved
work) and `blocked`. Everything else is either automatic
(`.github/workflows/status.yml`) or the human's — `planning → ready` is the
approval gate, and an agent must never make that move itself. Claiming an
issue out of `ready` is fine and expected; promoting your own plan out of
`planning` is not.

## Why not a Projects board

This was a user-owned Projects v2 board until D-026. Two problems, one fatal:

Projects v2 is reachable only from a classic PAT with `project` scope, because
fine-grained PATs expose Projects as an _organization_ permission and the board
was owned by a user account. A classic PAT cannot be restricted to one
repository, so "an agent credential that can only touch this repo" and "an
agent credential that can move the board" were mutually exclusive.

And it failed silently. `board.yml` read a `BOARD_TOKEN` secret that was never
set, and was written to no-op rather than fail when it was absent — so the
board sync was dead for the board's entire life without ever reddening a check.
Labels need only `issues: write`, which the default `GITHUB_TOKEN` already has,
so there is no longer a secret whose absence can quietly stop the lifecycle.

Labels also survive a migration to Linear or Jira, where a bespoke GitHub board
would not.

## Tokens

Agents working in this repo authenticate as a **fine-grained PAT restricted to
this repository**, supplied as `GH_TOKEN` through `.claude/settings.local.json`
(gitignored, project-scoped — it deliberately does not apply to any other
checkout). It needs, on `chpy04/resumix` only:

| permission      | level | for                                             |
| --------------- | ----- | ----------------------------------------------- |
| Contents        | RW    | branches, the `feedback-assets` orphan branch   |
| Issues          | RW    | issues, comments, `status:*` labels, sub-issues |
| Pull requests   | RW    | opening PRs, review replies                     |
| Workflows       | RW    | editing anything under `.github/workflows/`     |
| Actions         | RW    | reading CI results, re-running failed jobs      |
| Commit statuses | Read  | the gate's verdict on a PR                      |

No account-level permission is needed, and **no `project` scope** — that
requirement died with the board. The same token can serve the app's
`GITHUB_TOKEN` for the feedback widget, which needs only Contents and Issues.

CI needs no secret at all: `status.yml` runs on the default `GITHUB_TOKEN`.

## Agents do not file issues unprompted

An issue is a human-requested behaviour, and only a human decides one exists.
Two things count as that decision: the human asking outright ("make a separate
issue for this"), and the `epic` label, whose children an agent creates as
sub-issues while planning it. Nothing else — a bug you tripped over, a
refactor that suggests itself, a follow-up the PR made obvious — goes in your
reply or as a comment on the issue you are already working.

A new request arriving mid-task is **scope creep onto the current issue**, and
that is the normal case rather than a problem. Extend the issue and update its
plan; do not split the work on your own initiative. See `CLAUDE.md`.

## Issue templates

`.github/ISSUE_TEMPLATE/*.yml` — `bug`, `feature`, `chore`. Each applies its
own label, so an issue's type is readable off a list without opening it. The
`epic` label is separate and applied by hand: it is what routes an issue down
the epic track when an agent triages it, and it is never inferred.

The in-app feedback widget files issues through the REST API
(`lib/feedback/issue.ts`), which **bypasses templates entirely**. Keep the
`bug` template's fields aligned with the body that widget generates, or the
tracker ends up with two dialects of bug report.

## PRs

- `Closes #<n>` in the body, not the title. GitHub parses it into a real link,
  and `status.sh pr-issues` reads that link rather than regexing the body — so
  what changes the status is exactly what GitHub will close.
- One issue per PR. A PR that closes three issues is three tasks wearing a
  trench coat, and each of them loses the ability to say where it is.
- Draft means "not ready": `status.yml` leaves a draft PR's issue alone.

## Workflow conventions

The existing workflows are one job each, named for the gate step they run
(`lint`, `test`, `build`, …), sharing `.github/actions/setup-node-deps`.
`status.yml` is the exception that does not run the gate at all; keep it that
way, and keep CI concerns out of it.
