---
name: implement
description: Build one approved issue and open its PR. Invoked by hand as `/implement <issue-number>` when a human points you at an issue already in status:ready. Claims it, works in a dedicated worktree, runs the full merge gate, and opens the PR. Never merges, and never invokes another skill.
---

# Implement an approved issue

You have been pointed at **one** issue whose plan a human has already
approved. Claim it, build exactly what the plan says, get `npm run verify`
green, and open the PR. Then stop.

The whole lifecycle is in `CLAUDE.md`; this is the second of its three phases.
`/triage` planned it and `/review-pr` handles review. **Never invoke them** —
a human decides when a phase begins.

This is the **unattended** path. When a human is in the session with you, none
of this applies — follow the walk in `CLAUDE.md` directly, take approval in
conversation, and do not invoke this skill.

## Hard limits

- **Never merge.** Opening the PR is where you stop. `status.yml` moves the
  issue when a human merges.
- **Never file an issue unprompted.** If the work uncovers other work — a bug
  you tripped over, a refactor that suggests itself — put it in your reply, or
  comment on the issue you are already on. The issue list is the human's
  inbox, and only they decide what enters it.
- **Never widen the plan.** The approved plan is the contract. If the right
  change turns out to be bigger, that is a `status:blocked` and a question,
  not a judgement call you make alone.

## 1. Check it is actually yours to take

```bash
scripts/status.sh get <n>
```

It must read `status:ready`. Anything else and you stop and say why:

- `status:backlog` or `status:planning` — not approved yet. `planning → ready`
  is a human gate and you may not cross it, even if the plan looks fine.
- `status:in-progress` — another agent has it. Two worktrees on one issue is
  how you get a merge conflict with yourself.
- `status:in-review` / `status:done` — there is already a PR. `/review-pr`.

Then read the issue and the plan inside it:

```bash
gh issue view <n> --comments
```

The plan lives in the body between `<!-- resumix:plan -->` markers. If there
is none, stop — an unplanned issue is `/triage`'s job, not yours.

## 2. Claim it before you write anything

```bash
scripts/status.sh set <n> in-progress
```

Before, not after. The label is how a second agent reading the issue list sees
the work is taken.

## 3. Worktree and branch

One issue = one agent = one worktree = one branch.

```bash
git -C /Users/chrispyle/resumix fetch origin
git worktree add ../resumix-wt/<n> -b <type>/<n>-<slug> origin/main
ln -s /Users/chrispyle/resumix/node_modules ../resumix-wt/<n>/node_modules
ln -sfn /Users/chrispyle/resumix/.env ../resumix-wt/<n>/.env
```

`<type>` matches the issue's type label — `feat/`, `fix/`, `chore/`. Branch
from `origin/main`, never from local `main`, which may be behind.

`node_modules` is symlinked, not installed — **never run `npm install` in a
worktree** unless you mean to replace that symlink. `.env` is symlinked too,
because the gate's integration tests need `DATABASE_URL` and silently skip
16 suites without it.

## 4. Build it

Read `CLAUDE.md`'s five invariants before touching anything. They are all
silent — nothing fails at the moment you break one.

Then read the `.claude/rules/` file for every area you are about to edit. They
load automatically on matching paths, and ESLint enforces the mechanical half
with error messages that name the rule file.

**Follow the existing pattern before inventing one.** This repo does the same
thing the same way in seven places. Find one and copy it; where it doesn't,
that inconsistency is the bug. A new pattern in a PR is a decision the plan
did not approve.

While you work:

- **Comments explain why.** The code says what. Match the density around you —
  every non-obvious decision in this repo already carries a reason or a
  D-number.
- **Update contracts in the same commit** as the code that changes them.
  `docs/SCHEMA.md`, `docs/API.md`, `docs/TEMPLATE_TOKENS.md` are
  authoritative, and a disagreement with reality is a bug in one of them. If
  the approved plan declared a contract frozen, comment on the issue instead
  of editing it.
- **Add a D-entry to `docs/DECISIONS.md`** for anything a future reader would
  want to reverse. Append-only; annotate a superseded entry rather than
  rewriting it.
- **Update `docs/STATE.md` only where your change made something in it
  untrue.** It is present tense, not a changelog — never append to record that
  work happened.
- **Prefer deleting.** If nothing imports it, remove it.

Commit in small imperative steps. Reference the issue in the body, never the
subject, so `git log --oneline` stays readable.

## 5. The gate

```bash
docker compose up -d db latex
npm run verify
```

Run the whole thing, not a subset — `format:check`, `lint`, `typecheck`,
`test`, `build`, reseed, `smoke`, `test:e2e`, in an order where each step
catches what the previous cannot. In particular `typecheck` is **not** enough:
`next build` additionally validates App Router export signatures, and a page
whose default export takes a custom prop typechecks fine and fails the build.

Expect **184 passing, 0 skipped**. A non-zero skip count means `DATABASE_URL`
is missing and the integration suites self-skipped while still reporting
green — that is a failed run wearing a pass.

Never report green you have not seen. If a step fails and you cannot fix it
inside the plan, that is §7.

## 6. Open the PR

```bash
git push -u origin <branch>
gh pr create --base main --title "…" --body "…"
```

The body must contain `Closes #<n>` — GitHub parses it into a real link, and
`status.sh pr-issues` reads that link rather than the text, so what drives the
status is exactly what GitHub will close. One issue per PR.

Write the body for a reviewer who has not read the plan: what changed, why,
and what you verified — with the actual numbers from the gate, not "tests
pass". Call out anything you did that the plan did not cover, rather than
letting the reviewer discover it in the diff.

Open it as a draft if it is not ready. Marking it ready is what sets
`status:in-review`; never hand-set that label.

Then **stop**. Do not merge.

## 7. When you get stuck

```bash
scripts/status.sh set <n> blocked
gh issue comment <n> --body "…"
```

Comment with the precise question and what you have already ruled out, then
stop. A blocked issue is information; a guess that got merged is a bug.

Block when: the plan turns out to contradict an invariant or a contract; the
right fix is materially larger than what was approved; or two reasonable
implementations differ in a way a human would care about. Do not block on
anything you can decide and write down in the PR body.
