---
paths:
  - '.github/**'
  - 'scripts/board.sh'
---

# GitHub: issues, the board, and PRs

The lifecycle every task follows is in `CLAUDE.md`. This file is the
mechanical half — the commands, and the conventions for the plumbing itself.

## The board

One Projects v2 board, user-owned (`chpy04`), with a single-select `Status`
field holding exactly seven options:

`Backlog` · `Planning` · `Ready` · `In Progress` · `In Review` · `Blocked` ·
`Done`

`Ready` and `In Progress` look redundant and are not: `Ready` means a human
approved the plan, `In Progress` means an agent has claimed the work. Merging
them loses the ability to see a queue of approved-but-unstarted work.

Those names are load-bearing. `scripts/board.sh` looks an option up **by
name** and fails loudly if it is missing, so renaming a column in the GitHub
UI breaks the workflow — rename it here and in `CLAUDE.md` in the same commit.

## Moving a card

```bash
scripts/board.sh move <issue-number> "Planning"
scripts/board.sh pr-issues <pr-number>     # the issues a PR closes
```

Agents move a card to `Planning` (starting to plan), `In Progress` (claiming
approved work) and `Blocked`. Everything else is either automatic
(`.github/workflows/board.yml`) or the human's — `Planning → Ready` is the
approval gate, and an agent must never make that move itself. Claiming an
issue out of `Ready` is fine and expected; promoting your own plan out of
`Planning` is not.

## Tokens

Projects v2 is GraphQL-only and needs `project` scope, which is **not** in the
default set:

```bash
gh auth refresh -s project -s read:project
```

CI cannot use the default `GITHUB_TOKEN` for this — it has no access to a
user-owned board at any permission level. `board.yml` reads a `BOARD_TOKEN`
repository secret instead (a fine-grained PAT, read/write on Projects). When
that secret is absent every job in the workflow no-ops with a notice rather
than failing, so a token rotation stops the board rather than reddening CI.

## Issue templates

`.github/ISSUE_TEMPLATE/*.yml` — `bug`, `feature`, `chore`. Each applies its
own label, so a card's type is readable off the board without opening it.

The in-app feedback widget files issues through the REST API
(`lib/feedback/issue.ts`), which **bypasses templates entirely**. Keep the
`bug` template's fields aligned with the body that widget generates, or the
board ends up with two dialects of bug report.

## PRs

- `Closes #<n>` in the body, not the title. GitHub parses it into a real link,
  and `board.sh pr-issues` reads that link rather than regexing the body — so
  what moves the card is exactly what GitHub will close.
- One issue per PR. A PR that closes three issues is three tasks wearing a
  trench coat, and the board loses the ability to say where any of them are.
- Draft means "not ready": the board leaves a draft PR's card alone.

## Workflow conventions

The existing workflows are one job each, named for the gate step they run
(`lint`, `test`, `build`, …), sharing `.github/actions/setup-node-deps`.
`board.yml` is the exception that does not run the gate at all; keep it that
way, and keep CI concerns out of it.
