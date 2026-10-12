---
name: implement
description: Take one GitHub issue from backlog to an open PR in a single unattended pass, or, for a `plan-first` issue, to an approved plan on the Excalidraw board first. Invoked by hand as `/implement <issue-number>`; it takes exactly one issue number and never scans the issue list. You are the orchestrator — you delegate planning, building and verification to the `planner`, `implementer` and `verifier` subagents, judge their output, and open the PR. Never merges.
disable-model-invocation: true
---

# Implement an issue, end to end

You have been pointed at **one** issue. Take it from ticket to open PR with no
human in the loop. The PR is the only human checkpoint (D-036), with one
exception: an issue labelled **`plan-first`** stops after planning, and you put
the plan on the Excalidraw board for a human to approve before anything is
built (§3a).

**You are the orchestrator, not the worker.** You hold the ticket, the plan
and the verdicts. Three subagents in `.claude/agents/` do the work:

| subagent      | does                                                 | never                |
| ------------- | ---------------------------------------------------- | -------------------- |
| `planner`     | reads the code, writes the plan                      | edits a file         |
| `implementer` | builds the plan in the worktree, commits             | pushes, touches `gh` |
| `verifier`    | checks the diff against ticket + plan, runs the gate | edits a file         |

You do the plumbing between them (status label, worktree, board, push, PR)
and the judging. **Do not write or fix code yourself**, even a one-line fix. If you
do, nobody independent has checked it.

The label and PR conventions are in `.claude/rules/github.md`. Read it first.

This skill is `disable-model-invocation: true`, so something typed
`/implement <n>` to get you here. **An ordinary session with a human in it does
none of this.** It follows `CLAUDE.md`.

## Hard limits

- **Exactly one issue, and it is given to you.** If you were invoked without a
  number, ask which one. Never list or search issues to pick one yourself.
- **Never merge.** Opening the PR is where you stop.
- **Never file an issue.** Other work you notice goes in the PR body under
  "Noticed, not done".
- **Never touch production.** See `CLAUDE.md`, "Production is not yours".

## 1. Check it is yours to take

```bash
scripts/status.sh get <n>
gh issue view <n> --comments
```

It must read `status:backlog`. Otherwise stop and say why:
`in-progress` means another agent has it, `in-review`/`done` means a PR
already exists, and `blocked` or `plan-review` means it is waiting on a human.

Then claim it **before** doing anything else. A second agent reading the
label must see that the issue is taken:

```bash
scripts/status.sh set <n> in-progress
```

Then find out which path this is:

```bash
gh issue view <n> --json labels,comments \
  --jq '(.labels[].name | select(. == "plan-first")),
        (.comments[].body | capture("<!-- resumix:plan-board (?<url>\\S+) -->").url)'
```

| `plan-first`? | board comment? | path                                                  |
| ------------- | -------------- | ----------------------------------------------------- |
| no            | —              | §2 → §3 → §4: straight to a PR                        |
| yes           | no             | §2 → §3 → §3a: draw the plan, then stop               |
| yes           | yes            | §2 → §3b: a human sent it back; revise it or build it |

If more than one board comment exists, the newest wins.

## 2. Worktree

If `../resumix-wt/<n>` already exists from an earlier plan-first pass, and
`git -C ../resumix-wt/<n> log origin/main..HEAD` is empty (planning commits
nothing), reuse it after `git -C ../resumix-wt/<n> rebase origin/main`.
Otherwise:

```bash
git -C /Users/chrispyle/resumix fetch origin
git -C /Users/chrispyle/resumix worktree add ../resumix-wt/<n> -b <type>/<n>-<slug> origin/main
ln -s /Users/chrispyle/resumix/node_modules /Users/chrispyle/resumix-wt/<n>/node_modules
ln -sfn /Users/chrispyle/resumix/.env /Users/chrispyle/resumix-wt/<n>/.env
```

`<type>` follows the issue's label: `bug` → `fix/`, `enhancement` → `feat/`,
`chore` → `chore/`. Every subagent gets the absolute worktree path and works
only there.

## 3. Plan

Spawn `planner` with the issue title, body and comments verbatim, plus the
worktree path. It returns a plan in a fixed shape.

**Review it yourself** before anything gets built. Reject and re-spawn with
specific objections if any of these fail:

- Every observable outcome in the ticket maps to a step. Nothing in the ticket
  is dropped, and nothing outside it is added.
- Each step names the existing file whose pattern it copies. A plan that
  invents a pattern where the repo already has one is wrong.
- It names every contract (`docs/SCHEMA.md`, `API.md`, `TEMPLATE_TOKENS.md`),
  doc and test that moves with the change.
- It does not break any of `CLAUDE.md`'s five invariants.
- It says how each outcome will be verified. That means a test, the gate or
  an e2e spec, not "manually".

Allow at most **two** re-plans. If the third plan still fails, the ticket is
the problem; go to §7.

Keep the accepted plan verbatim. You will pass it to every later subagent
and put it in the PR.

On a `plan-first` issue, tell the planner so. It then also returns a
**What it looks like** section, and you go to §3a instead of §4.

## 3a. Plan first: put it on the board and stop

The board is where the human reviews designs. It is an Excalidraw+ scene,
one per issue, in the **plans** collection (`361y65iPzU8`) of workspace
`1RlL9EpjGX8`, named `#<n> <issue title>`. Drawing it is plumbing, not code,
so you do it yourself.

If the Excalidraw tools (`mcp__excalidraw__*`) are not available, `herd.sh`
was not used to launch you or the server is down. Do not fall back to a
plan in the issue. Go to §7, and say that is why.

Before the first write, call the matching format guide: `read_diagram_format`
for the flow, `read_freeform_format` for mockups and text blocks. Then
`create_scene` and lay out, left to right:

1. **The ticket.** Its title, one-line restatement, and the issue URL.
2. **How.** The steps as a diagram (`create_diagram`): the files and call
   paths that change, each labelled with the existing file it copies.
3. **What it looks like.** The result as the human will meet it: a wireframe
   of the changed screen, a before/after, or a sample of the API or output.
   This is the part that cannot be said in an issue comment, so do not skip
   it for a "backend-only" ticket. Show what is observably different.
4. **Decisions a reviewer might reverse**, and any open question, each as its
   own short block so a sticky note can sit next to it.
5. **Plan text.** The accepted plan verbatim, in one text block. §3b builds
   from this block, so it must be the whole plan.

`take_screenshot` and fix anything cut off or overlapping. Then hand it over:

```bash
gh issue comment <n> --body-file <file>
scripts/status.sh set <n> plan-review
```

The comment carries the scene URL, a few lines on the approach, how to
respond, and the marker that §1 looks for, on its own line:

```
<!-- resumix:plan-board https://app.excalidraw.com/s/1RlL9EpjGX8/<scene-id> -->

To ask for changes, put sticky notes on the board, then move this issue back
to backlog. To approve, move it back to backlog with no sticky notes on the
board: `scripts/status.sh set <n> backlog`.
```

Then report the board URL and stop. Leave the worktree in place.

## 3b. Plan first: the human sent it back

A human moved the issue back to `backlog`. Read the board with
`get_scene_content`, since they may have edited it as well as annotated it.

**Sticky notes on the board mean "revise".** Collect each one with the
element it sits next to. Spawn `planner` with the ticket, the current plan
text from the board, and the notes, and review its revision as in §3 (same
two re-plan limit). Update the board in place: change the blocks the notes
asked about, rewrite the plan text block, and delete each sticky once it is
folded in. Do not keep a changelog on the board. Then comment on the issue
with a few lines on what changed, a fresh marker line, and the same "how to
respond" text. Set `plan-review` again and stop.

**No sticky notes means "approved".** The plan text block, as it stands now,
is the accepted plan, including any edits the human made to it. If they also
changed the other blocks in a way the plan text does not reflect, the board
disagrees with itself. Go to §7 and ask which one is right instead of
picking. Otherwise go to §4 with that plan.

## 4. Build → verify, until it passes

**Build.** Spawn `implementer` with the worktree path, the ticket and the
accepted plan.

**Verify.** Spawn a **fresh** `verifier` every round, with the worktree path,
the ticket, the plan, and the base (`origin/main`). A fresh one has not seen
its own earlier findings, so it re-checks everything instead of only the
fixes. It returns `PASS` or `FAIL` with findings and the gate's numbers.

**Judge the verdict.** Do not relay it blindly:

- `PASS`: confirm it reported the gate's real numbers (a pass count and
  **0 skipped**). If it did not, treat the verdict as `FAIL`.
- `FAIL`: drop any finding that asks for work outside the plan, or that
  contradicts `CLAUDE.md` or a D-entry. Send the rest back to the
  implementer as a numbered list. If you can resume the same implementer
  (`SendMessage`), do that so it keeps its context. Otherwise spawn a new
  one with the plan and the findings.

Repeat for at most **three** build→verify rounds. A finding that survives
three rounds usually means the plan is wrong, not the code. Go to §7 with
what you have.

## 5. Open the PR

```bash
git -C <worktree> push -u origin <branch>
gh pr create --base main --head <branch> --title "…" --body-file <file>
```

Title: imperative, under 70 characters, no issue number. Body, in this order:

- **Summary**: what changed and why, in a few lines.
- **Decisions a reviewer might reverse**: calls you or the planner made that
  the ticket did not dictate, each with its reason. This section is the
  reason the reviewer reads the PR.
- **Verification**: the verifier's final gate numbers, and which test covers
  each outcome.
- **Noticed, not done**: out-of-scope findings, if any.
- The accepted plan, inside `<details><summary>Plan</summary>…</details>`.
  On a `plan-first` issue, link the board above it: the human approved the
  board, so they review the PR against it.
- `Closes #<n>`.

Opening it non-draft sets `status:in-review` automatically (`status.yml`).
Do not set that label yourself.

## 6. Report and stop

Reply with the PR URL, the number of plan and build rounds, the final gate
numbers, and the "reverse" decisions. Then stop.

Leave the worktree in place so the reviewer's follow-up can reuse it.

## 7. When it cannot be finished

Stop and hand it to the human if any of these is true:

- The ticket is ambiguous, and the readings would produce different PRs.
- The ticket contradicts an invariant or a contract.
- The ticket needs a new dependency, or needs the production instance.
- The plan or build loop ran out of rounds.
- A `plan-first` issue, and the Excalidraw tools are unavailable.
- An approved board whose plan text disagrees with its other blocks (§3b).

```bash
scripts/status.sh set <n> blocked
gh issue comment <n> --body "…"
```

The comment gives the precise question and what you ruled out. If code
exists, first push it and open a **draft** PR that lists the unresolved
findings, then link the draft in the comment.

If a question has a sensible default, do not block on it. Pick the default
and list it under "Decisions a reviewer might reverse". Blocking costs a human
round-trip; a listed decision costs only a read.
