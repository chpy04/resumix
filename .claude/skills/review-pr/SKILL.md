---
name: review-pr
description: Work an open PR until it is mergeable. Invoked by hand as `/review-pr <pr-number>` when a human points you at one PR with review feedback or failing CI; it takes exactly one PR number and never scans open PRs. Answers every comment — fixing, or disagreeing with a reason — and gets the merge gate green. Never merges, and never invokes another skill.
disable-model-invocation: true
---

# Get a PR to mergeable

You have been pointed at **one** open PR. Answer everything outstanding on it,
get the gate green, and hand it back. Then stop.

This is the last of the three **unattended** phases. **Never invoke
`/triage` or `/implement`** — a human decides when a phase begins.

Everything this skill leans on that is not written here — the seven
`status:*` labels, the `planning → ready` human gate, `scripts/status.sh`,
the worktree and branch convention, the PR conventions — is in
`.claude/rules/github.md`. Read it first.

You are here because something typed `/review-pr <pr>`. That is the only way in: this
skill is `disable-model-invocation: true` and never fires on its own, on a
task that merely resembles its description, or at another skill's request.
**An ordinary session with a human in it does none of this** — it follows
`CLAUDE.md` and takes approval in conversation. If that is your situation,
you should not be reading this.

## Hard limits

- **Exactly one PR, and it is given to you.** `/review-pr <pr-number>` takes the number as its argument. If you were invoked without one, ask which PR — never list, search or scan to pick one yourself, and never work more than one in a single invocation. Choosing what to work on is the human's job, and an agent that goes looking will find work nobody queued.
- **Never merge.** Even when the gate is green and a human has approved.
  Merging is irreversible and outward-facing; the human presses it, and
  `status.yml` closes the issue and sets `status:done` from there.
- **Never file an issue unprompted.** Follow-ups go in a PR comment or your
  reply, and the human decides whether any of them becomes an issue.
- **Never force-push.** Reviewers lose their place and inline comments detach
  from their lines. Add commits.
- **Never resolve a thread you did not satisfy.** If you pushed back instead
  of changing the code, the thread stays open for the human to settle.

## 1. Gather everything outstanding

```bash
gh pr view <pr> --json title,body,isDraft,mergeable,reviewDecision,statusCheckRollup
gh pr checks <pr>
gh pr diff <pr>
gh api repos/chpy04/resumix/pulls/<pr>/comments      # inline review comments
gh pr view <pr> --comments                            # top-level discussion
```

Then read the issue behind it, because the approved plan is the standard the
PR is measured against — not your own taste:

```bash
scripts/status.sh pr-issues <pr>
gh issue view <n>
```

Work in the PR's existing worktree if it is still there
(`../resumix-wt/<n>/`); otherwise check the branch out into a fresh one the
same way `/implement` does. Never work on `main`.

## 2. Triage each comment into one of three

Go through every unresolved comment. Each is exactly one of:

**Fix it.** The reviewer is right. Change the code, and reply on the thread
saying what you changed — not "done", which makes the reviewer re-read the
diff to find out what you did.

**Push back.** You think the reviewer is wrong, or the change would break
something they cannot see from the diff. Say so on the thread, with the
reason and the evidence: the invariant it would violate, the test that
covers it, the D-number that decided it. Then **leave the thread open**. You
are not the one who settles it — you are making sure the human settles it
knowing what you know. Do not quietly comply with a change you believe is
wrong, and do not quietly ignore one you disagree with.

**Out of scope.** A real point, but not this PR's job. Say that plainly, say
where it belongs, and leave it to the human. Do not expand the PR to absorb
it — that is how an approved plan becomes an unreviewed one.

Being right and being agreeable are different things, and a review is where
the difference matters. A reviewer who is wrong and unchallenged ships the
bug.

## 3. Failing CI is the same job

A red check is a comment from the machine. Read the actual failure — never
re-run hoping:

```bash
gh run view <run-id> --log-failed
```

Then reproduce it locally and fix it. Match the failure to the gate step:
`prettier` → `npm run format`; `eslint` → the rule message names the
`.claude/rules/` file that explains it; `node-test` → a non-zero skip count
means `.env` is missing, not that the tests passed; `next-build` failing while
`tsc` passed is usually an App Router export signature; `round-trip` failing
means the seeded V1 resume no longer renders byte-identically, which is the
project's acceptance bar and never something to work around.

## 4. Re-run the gate and push

```bash
docker compose up -d db latex
npm run verify
```

The whole gate, on the final state of the branch — not the subset you think
your change touched. **184 passing, 0 skipped.**

Commit and push to the same branch. Changes requested sets
`status:in-progress` again on its own; you do not set it.

## 5. Report and stop

Tell the human, in their reply:

- what you fixed, one line each
- **what you pushed back on, and why** — this is the part they most need,
  because it is the part still needing a decision
- what you left out of scope
- the gate result, with numbers
- whether the PR is now mergeable, and anything blocking it that you cannot
  resolve

Then stop. Do not merge, and do not mark a draft ready unless the human asked
for that — marking it ready is what sets `status:in-review`.

If something genuinely needs a human decision before the PR can move — two
reviewers disagreeing with each other, a review that contradicts the approved
plan — set the _issue_ to `status:blocked`, comment with the precise question,
and stop.
