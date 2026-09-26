---
paths:
  - '.github/**'
  - 'scripts/status.sh'
  - 'scripts/herd.sh'
  - 'scripts/verify-serial.sh'
  - '.claude/skills/**'
  - '.claude/agents/**'
---

# GitHub: issues, status, and PRs

**This is the unattended pipeline's rulebook, and nothing else reads it.**
It is the shared half of `/implement` and its three subagents. It covers the
lifecycle they move an issue through, plus the commands and conventions for
the plumbing itself.

An ordinary session with a human in it does **none** of this. It follows
`CLAUDE.md`: branch, build, gate, commit, approval in conversation. Do not
file an issue, do not move a label. If you are reading this because you
opened a file under `.github/`, you want the mechanics below, not the
lifecycle.

## The lifecycle: one pass, one human checkpoint

An issue in backlog is a go-ahead. One agent takes it from backlog to an open
PR without stopping, and the PR is the only place a human reviews (D-036).

The exception is an issue labelled **`plan-first`**: the agent plans, draws
the plan on the Excalidraw board, sets `status:plan-review` and stops. The
human annotates the board with sticky notes and moves the issue back to
`backlog`, and the agent revises the board and stops again. Moving it back
with **no** sticky notes is the approval, and the next pass builds it straight
through to a PR. The label goes on by hand, or from the feedback widget's
**Create a plan first** switch.

Task state is one `status:*` label on the issue, and that label is the only
record. Nothing in `docs/` tracks progress.

| label                | means                                            | set by    |
| -------------------- | ------------------------------------------------ | --------- |
| `status:backlog`     | a go-ahead; the next `herd.sh` run will start it | automatic |
| `status:in-progress` | an `/implement` agent has claimed it             | agent     |
| `status:plan-review` | a `plan-first` plan is on the board for a human  | agent     |
| `status:in-review`   | PR is open and not a draft; waiting on the human | automatic |
| `status:blocked`     | needs a human: a question, or a rejected PR      | agent, CI |
| `status:done`        | PR merged, issue closed                          | automatic |

`/implement <n>` is an orchestrator. It keeps the ticket, the plan and the
verdicts in its own context, and it hands the work to three subagents in
`.claude/agents/`:

```
planner ──plan──▶ orchestrator reviews it (≤2 re-plans)
                        │
                        ├── plan-first ──▶ Excalidraw board ──▶ plan-review (stop)
                        ▼
              ┌─▶ implementer ──commits──▶ verifier ──PASS──▶ push + PR
              └──── findings ◀──FAIL────────┘   (≤3 rounds)
```

The orchestrator does the plumbing: label, worktree, board, push, PR. It never
writes code, because then nothing independent would have checked that code.
The planner and the verifier never edit a file. The implementer never
pushes. The verifier is spawned fresh each round, so it re-checks the whole
diff and not only the fixes.

`scripts/herd.sh` starts it. The script reads every open issue and launches
one agent per `status:backlog` issue. An issue that is not ready to hand
over should be set to `blocked`, not left in backlog.

Issues from the in-app feedback widget open in `backlog` like any other, and
run unattended. That rests on every account on the production instance being
the owner's: the widget's text becomes the instructions of an agent running
with `bypassPermissions`. If production ever has other users, gate the widget
again before anything else.

Herd agents run with `--strict-mcp-config`, so they have no MCP server.
A `plan-first` agent gets the Excalidraw server alone, copied out of
`~/.claude.json` by `herd.sh`.

Review feedback on a PR is not part of the pipeline. Address it in an
attended session.

### One issue, one agent, one worktree, one branch

Branch `feat/<n>-<slug>` (or `fix/`, `chore/`, matching the issue's type
label), worktree at `../resumix-wt/<n>/`, outside the repo and never
committed. `node_modules` and `.env` are symlinked in from the main
checkout. Don't run `npm install` in a worktree unless you mean to replace
that symlink.

Every worktree shares the dev database and port 3100, so the verifier runs
the gate through `scripts/verify-serial.sh`. That script is `npm run verify`
behind a machine-wide lock. Parallel agents queue at the gate instead of
reseeding each other's database in the middle of a run.

## Exactly one label at a time

**An issue wears exactly one of the six labels above.** `scripts/status.sh`
enforces that. It adds the new label before stripping the old ones, because
an issue briefly wearing two is recoverable and an issue wearing none is
invisible. Never add or remove a `status:` label by hand or through
`gh issue edit`; that is how an issue ends up in two states at once.

Those names are load-bearing. `status.sh` validates against the list above
and fails loudly on anything else. Adding an unrecognised label through the
API would have GitHub silently create it in a random colour rather than fail.

## Setting it

```bash
scripts/status.sh set <issue-number> "In Progress"   # or: in-progress
scripts/status.sh get <issue-number>
scripts/status.sh pr-issues <pr-number>              # the issues a PR closes
```

`set` takes either dialect — `"In Progress"` as the lifecycle table above
writes it, or `in-progress` as the label spells it.

Agents set `in-progress` (claiming a backlog issue, before any work),
`plan-review` and `blocked`. `.github/workflows/status.yml` sets everything else: backlog on
open, in-review on a ready PR, and done or blocked when a PR closes merged
or unmerged. A human unblocks an issue, or answers a plan, by moving it back
to `backlog`.

`plan-first` is not a status. It sits beside one and never changes, so the
issue stays plan-first through every revision. `/implement` tells the first
pass from a later one by the `<!-- resumix:plan-board <url> -->` comment it
leaves on the issue.

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

| permission      | level | for                                           |
| --------------- | ----- | --------------------------------------------- |
| Contents        | RW    | branches, the `feedback-assets` orphan branch |
| Issues          | RW    | issues, comments, `status:*` labels           |
| Pull requests   | RW    | opening PRs, review replies                   |
| Workflows       | RW    | editing anything under `.github/workflows/`   |
| Actions         | RW    | reading CI results, re-running failed jobs    |
| Commit statuses | Read  | the gate's verdict on a PR                    |

No account-level permission is needed, and **no `project` scope** — that
requirement died with the board. The same token can serve the app's
`GITHUB_TOKEN` for the feedback widget, which needs only Contents and Issues.

CI needs no secret at all: `status.yml` runs on the default `GITHUB_TOKEN`.

## Agents do not file issues unprompted

An issue is a human-requested behaviour, and only a human decides one
exists. The human asking outright ("make a separate issue for this") is the
only thing that counts as that decision. Everything else goes in the PR
body's "Noticed, not done" section: a bug you tripped over, a refactor that
suggests itself, a follow-up the PR made obvious.

Each issue is one PR's worth of work. Anything bigger is the human's to plan
and split before filing.

## Issue templates

`.github/ISSUE_TEMPLATE/*.yml` — `bug`, `feature`, `chore`. Each applies its
own label, so an issue's type is readable off a list without opening it, and
`/implement` uses the label to pick the branch prefix.

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
