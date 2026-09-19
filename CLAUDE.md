# CLAUDE.md

Deliberately thin. It carries what must be in context for _every_ change;
everything directory-specific lives in `.claude/rules/`, which loads only
when you touch matching files. Read `docs/STATE.md` first, then
`docs/ARCHITECTURE.md`. What is being _worked on_ is not in `docs/` at all —
it is on the GitHub issue (see "Task lifecycle" below).

## What this is

Content (experiences, projects, bullets, skills) is stored **once,
globally**. A **Resume** is a named selection + ordering of that content
(bridge tables, composite PKs, `sort_order`), bound to a **Template** (raw
LaTeX with `<<TOKEN>>` placeholders). Rendering = load selections →
substitute into the template → POST the `.tex` to a sidecar TeX Live
container → get a real `pdflatex` PDF back. Saved PDFs are snapshotted into
`resume_pdf`, so a resume's downloaded bytes never silently change when
content or templates are edited later.

The consequence worth internalising: **a resume stores no text.** Editing a
bullet is a global edit that instantly changes every resume that picked it.
That is intentional, and most "bugs" that turn out not to be bugs are this.

## Five invariants

Breaking any of these is silent — nothing fails loudly at the moment you do it.

1. **Archive, never delete.** No DELETE endpoints on content. `is_archived`
   hides it from pickers; resumes that already selected it keep rendering it
   forever (D-011).
2. **Content is raw, unescaped LaTeX.** Bullets legitimately contain
   `\textbf{}`, `\href{}{}`, `\$`, `\&`. Never add auto-escaping — it would
   corrupt every existing bullet (D-008).
3. **The DB client stays lazy.** Never hoist `postgres(...)`/`drizzle(...)`
   to module scope; `next build` evaluates every route module and would fail
   on any machine without a live `DATABASE_URL` (D-014).
4. **Nothing in the `middleware.ts` import graph may touch `node:crypto`.**
   Middleware runs on the Edge runtime. `lib/auth.ts` is Web Crypto only.
5. **Every query is scoped to a user.** Handlers begin with
   `const userId = await requireUserId(request)` (`lib/session.ts`) and pass
   it down; the query layer filters on it. `user_id` lives only on the five
   root tables (`template`, `experience`, `project`, `technical_skill_row`,
   `resume`) — bullets, skills, bridge rows and PDF snapshots inherit their
   owner through a join to their parent. Isolation is enforced in the
   queries, **not** in `middleware.ts`, which runs on the Edge and cannot
   reach the database. Another user's id must read as "not found", never
   "forbidden". `lib/queries/isolation.test.ts` is the executable form of
   this paragraph and the first thing to run after touching any query.

## Auth modes

`RESUMIX_AUTH_MODE` = `dev` | `password` | `supabase`, defaulting to `dev`
outside production and `password` in production (`lib/auth-mode.ts`). `dev`
means **no login screen**: the session is the first user in `users`, which is
whoever `npm run db:seed` created. `supabase` is a written-but-unimplemented
seam (`lib/auth-supabase.ts`) that fails closed. The browser suite pins
`RESUMIX_AUTH_MODE=password` so it drives the real login screen; dev and
supabase modes are covered in-process by `lib/session.test.ts`.

## Merge gate

```
npm run verify
```

That is `format:check`, `lint`, `typecheck`, `test`, `build`, reseed,
`smoke`, `test:e2e` — in an order that works. Requires
`docker compose up -d db latex`.

Run the whole thing, not a subset. Each step catches something the previous
one cannot:

- `typecheck` is **not** enough on its own. `next build` additionally
  validates App Router export signatures and resolves the webpack config; a
  page default export taking a custom prop typechecks fine and fails the
  build. That bug reached `main` once.
- `test` needs `DATABASE_URL` or 16 integration tests silently self-skip and
  still report green. Expect **184 passing, 0 skipped**.
- `smoke` reads live DB state and a prior Playwright run leaves edited
  content behind — hence the reseed before it.

## Directory rules

`.claude/rules/` holds the conventions for each part of the tree, loaded
when you edit matching files. ESLint enforces the mechanical half and its
error messages name the rule file.

| rule              | applies to                                   |
| ----------------- | -------------------------------------------- |
| `imports.md`      | all TS/TSX — two import regimes, by runtime  |
| `api-routes.md`   | `app/api/**`                                 |
| `data-access.md`  | `lib/queries/**`, `lib/db/**`, `drizzle/**`  |
| `components.md`   | `components/**`, `app/**/*.tsx`              |
| `styling.md`      | the same, plus `app/globals.css`             |
| `render-latex.md` | `lib/render/**`, `lib/latex.ts`, `services/` |
| `auth.md`         | the auth + middleware graph                  |
| `testing.md`      | `**/*.test.ts`, `e2e/**`, `scripts/**`       |
| `docs.md`         | `docs/**`                                    |
| `github.md`       | `.github/**`, `scripts/status.sh`            |

## Contracts

`docs/SCHEMA.md`, `docs/API.md`, `docs/TEMPLATE_TOKENS.md` are authoritative.
Code must match them; a disagreement is a bug in one of them to be fixed
deliberately, not papered over. Update the contract in the same commit as
the code. If an issue's approved plan declares a contract frozen, propose
the change in a comment on that issue — don't edit.

## How to work here

- **Follow the existing pattern before inventing one.** Most of this
  codebase does the same thing the same way in seven places; find one and
  copy it. Where it doesn't, that inconsistency is the bug.
- **Comments explain why.** The code says what. Every non-obvious decision
  in this repo already carries a comment naming its reason or its D-number —
  match that density, and add a D-entry to `docs/DECISIONS.md` for anything a
  future reader would want to reverse.
- **Prefer deleting.** Dead code here has a habit of looking load-bearing;
  30 unused type aliases survived four waves. If nothing imports it, remove it.
- **Keep logic pure and testable.** The valuable modules in this repo
  (`lib/render`, `lib/editor`) are pure functions with exhaustive unit tests
  and no framework. Reach for that shape before reaching for a hook.
- **Don't add a dependency** to solve something the platform does. There is
  no test framework, no assertion library, no state manager, and the LaTeX
  sidecar has zero runtime deps. That is deliberate.
- **`docs/` describes the present tense.** It says what exists, never what
  is planned or in flight — that lives on the issue. A merged change updates
  `docs/STATE.md` only where it changed what is true, not to record that it
  happened; the issue and the PR are the record of that.

## Task lifecycle

**Every piece of work a person asks for is one GitHub issue.** A feature, a
bug, a refactor, a docs pass — if a human requested it, it gets an issue
before it gets a branch. The issue's `status:*` label is the _only_ record of
task state. Nothing in `docs/` tracks progress; if you find yourself typing
"in progress" into a markdown file, you are in the wrong system.

**An issue represents a human-requested behaviour, so agents never open one
unprompted.** A human asking for one is the gate — "make a separate issue for
this" means file it, and so does an issue carrying the `epic` label, whose
children an agent creates as sub-issues while planning it. Absent that, no.
If you notice a bug while doing something else, or think of work worth doing,
say so in your reply — do not open an issue for it. The list is the human's
inbox, and an agent that files its own work item has quietly promoted its own
idea to a commitment nobody made.

**A new request mid-task is scope creep onto the issue you are already on.**
That is the default and it is fine — assume it unless the human says
otherwise. Do not split work into a second issue on your own initiative; if
you think it genuinely belongs apart, say why and let them decide. When the
new request changes what was planned, update the plan in the issue body so the
issue still describes what is actually being built.

| label                | means                                           | set by    |
| -------------------- | ----------------------------------------------- | --------- |
| `status:backlog`     | filed, nobody has triaged it                    | automatic |
| `status:planning`    | an agent is writing the approach into the issue | agent     |
| `status:ready`       | the plan is approved; **no agent has it yet**   | **human** |
| `status:in-progress` | an agent has claimed it and is working          | agent     |
| `status:in-review`   | PR is open and not a draft                      | automatic |
| `status:blocked`     | an agent needs a decision only a human can make | agent     |
| `status:done`        | PR merged, issue closed                         | automatic |

An issue wears **exactly one** of these. Set it with `scripts/status.sh`,
never with `gh issue edit` — the script is what strips the old label, and it
is the only reason an issue cannot end up in two states at once.

"Automatic" is `.github/workflows/status.yml` reacting to issue and PR events.
Never hand-set `status:in-review` or `status:done` — open or merge the PR and
let the workflow do it, so the status cannot disagree with git.

### Two ways work arrives

**In a session with a human.** The default, and almost always what you are
doing. Someone is right there, so the ceremony collapses:

- **Approval happens in conversation.** "Go ahead" _is_ the gate. Never make a
  human open GitHub to move a label that they have already approved out loud.
  Set the labels yourself as you pass through them, so the issue still tells
  the truth to anyone reading it later.
- **One issue, carried along as you go.** New requests extend it.
- **Do not invoke the skills below.** Have an issue if there is one, then
  worktree, branch, build, gate, PR — and move the label at each step.

The human gate is not deleted here, it is _relocated_: it still takes a person
to approve a plan, but that person is in the room and can say so directly.

**Unattended, through the skills.** When no one is watching, the label _is_ the
conversation, and the gate has to be a real stop. That is what the three skills
below are for.

### planning → ready is a human gate

No agent may decide its own plan is approved. You set `status:planning`, write
the plan into the issue, and **stop there** until a human approves it.

What differs between the two paths above is only _how the approval arrives_.
Unattended, it is a human swapping the label for `status:ready`, and there is
nothing else it could be. In a session, it is the human saying "go ahead" —
equally an approval, and you then set the label yourself to record that it
happened. What is forbidden either way is moving past `planning` on your own
judgement, with nobody having agreed to anything.

`ready` and `in-progress` are deliberately separate, because "approved" and
"someone is on it" are different facts and the tracker is useless if it cannot
tell them apart. `ready` is a queue of work that has been blessed and is
waiting for an agent. Moving `ready → in-progress` is how an agent **claims**
the issue — do it before writing code, not after, so a second agent reading the
issue list can see the work is taken.

So: `planning` is waiting on a human. `ready` is waiting on an agent.
`in-progress` means an agent already has it — including an agent reworking an
open PR after review, which is the same activity and keeps the same label.

### Three skills, for the unattended path

Each phase has a skill in `.claude/skills/`, invoked by hand, for work running
without a human in the loop. **In an ordinary session, ignore them** and follow
the walk directly — they exist to make an unattended agent stop where a human
would otherwise have interrupted it.

| skill             | phase                         | ends at                                          |
| ----------------- | ----------------------------- | ------------------------------------------------ |
| `/triage <n>`     | size the issue and plan it    | `status:ready`, or `status:planning` for a human |
| `/implement <n>`  | build it and open the PR      | a PR, never a merge                              |
| `/review-pr <pr>` | answer review until mergeable | green and answered, never a merge                |

**They never invoke each other.** A phase boundary is a human decision, and
three separate invocations is what keeps it one.

### The walk

1. **Have an issue.** `gh issue view <n>`. If the request arrived as a
   conversation and there is no issue for it, ask whether to file one rather
   than filing it — then carry that single issue through every step below.
2. **Plan in the open.** `/triage <n>` — it sizes the issue and writes the
   plan into the **issue body**, fenced by `<!-- resumix:plan -->`, below
   whatever the human wrote. The body rather than a comment, so a re-plan
   replaces the old one instead of burying it. That plan is the thing being
   approved — it is written for a reader who has not seen the code.
3. **Claim it**, once a human has set `status:ready`: `/implement <n>` sets
   `status:in-progress` and worktrees and branches as below. Small imperative
   commits; reference the issue in the body, not the subject, so
   `git log --oneline` stays readable.
4. **Open the PR** into `main` with `Closes #<n>` in the body. That link is
   what closes the issue on merge and what drives the label. Open it as a
   draft if it is not ready; marking it ready is what sets `status:in-review`.
5. **Survive review.** `/review-pr <pr>` answers every comment and gets the
   gate green again. Changes requested sets `status:in-progress` on its own —
   reworking a PR is still an agent working the issue.
6. **Merge.** The workflow closes the issue and sets `status:done`. Nothing
   to do by hand.

If you hit something only the human can answer, `scripts/status.sh set <n>
blocked`, comment with the precise question, and stop. A blocked issue is
information; a guess that got merged is a bug.

### Branches and worktrees

One issue = one agent = one worktree = one branch. Branch
`feat/<issue-number>-<slug>` (or `fix/`, `chore/` — match the issue's
type label), worktree at
`../resumix-wt/<issue-number>/`, outside the repo and never committed.
`node_modules` is symlinked in from the main checkout — don't run
`npm install` in a worktree unless you mean to replace that symlink.

The `gh` detail, and the token the agent credential needs, are in
`.claude/rules/github.md`.
