---
name: triage
description: Plan one issue, or re-plan one whose plan got feedback. Invoked by hand as `/triage <issue-number>` for work running without a human in the loop. On an unplanned issue it sizes it and writes a plan of proportional depth into the issue body; on an issue already in status:planning it collects the feedback left since that plan and answers it. Never writes code, and never invokes another skill.
---

# Triage an issue

You have been pointed at **one** issue. Size it, plan it at a depth that
matches its size, and give it the right status. Then stop.

The whole lifecycle is in `CLAUDE.md`; this skill is the first of its three
phases. `/implement` and `/review-pr` are the other two. **Never invoke
them** — a human decides when a phase begins, and that is the point of having
three separate skills.

This is the **unattended** path. When a human is in the session with you, none
of this applies — follow the walk in `CLAUDE.md` directly, take approval in
conversation, and do not invoke this skill. It exists to make an agent stop
where a human would otherwise have interrupted it.

## Hard limits

- **Never write code.** Not in the plan, not in a scratch file. You are
  deciding things a human would want to overrule — architecture, structure,
  the shape of the data. A code block in a plan is you deciding something
  that was never yours to decide, and it is what `/implement` is for.
- **Never file an issue unprompted.** A human asking for one is the gate, and
  so is the `epic` label, whose children Track C creates as sub-issues. Absent
  that, no — if you notice other work worth doing, say so in your reply.
  A new request that arrives mid-task is scope creep onto _this_ issue, and
  the plan gets updated rather than split.
- **Never set `status:ready` on Track B or C.** `planning → ready` is a human
  approval gate (`CLAUDE.md`). Track A self-approves because there was no
  architectural decision to approve; B and C stop and wait.

## 1. Read the issue, then read enough to plan it

```bash
gh issue view <n> --comments
scripts/status.sh get <n>
```

If it already carries `status:in-progress`, `status:in-review` or
`status:done`, stop and say so — somebody is on it, and re-planning underneath
them is how two agents collide.

If it carries **`status:planning`** and its body already has a plan, you are
**re-planning**: a human has left feedback on that plan and you are answering
it. Jump to §7 — the sizing in §2 is already settled and must not be redone.

Then read what the change would actually touch. Always `CLAUDE.md` (the five
invariants) and `docs/STATE.md`. Then, as relevant: `docs/ARCHITECTURE.md`,
the contracts (`docs/SCHEMA.md`, `docs/API.md`, `docs/TEMPLATE_TOKENS.md`),
and the `.claude/rules/` file for each area the work lands in.

Read the code too. You are not writing it, but a plan built without looking is
a guess, and this repo does the same thing the same way in seven places — the
right plan is usually "copy the one in `lib/queries/experience.ts`", and you
can only say that if you looked.

## 2. Size it

**Is the `epic` label on it?** → **Track C**. Never infer this. An issue is an
epic because a human said so.

Otherwise choose between A and B:

|                          | **Track A — small**                                              | **Track B — feature**                                    |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| feels like               | "there's a bug on this page", "can we have a button that does X" | "add another kind of content to the resume"              |
| implementation           | obvious, and local to one or two files                           | more than one layer, or a judgement call about structure |
| schema                   | untouched                                                        | touched, or a contract in `docs/` changes                |
| a human reading the plan | would shrug — there was only one way to do it                    | might say "no, do it the other way"                      |

When genuinely torn, choose B. The cost of B on a small issue is a human
reading six extra lines. The cost of A on a large one is an agent silently
committing to an architecture nobody reviewed.

## 3. Plan at the depth the track calls for

### Track A

Append a plan to the issue body (see §4). Five lines is a good length:

- what changes, in one sentence
- which files
- how it is verified

No diagram. Then `scripts/status.sh set <n> ready`. That is the whole track.

### Track B

A plan a human can disagree with. In the issue body:

- **Requirements** — what must be true when this is done. Observable, not
  implementation.
- **Key decisions** — the two to five calls you made that a human might
  overrule, each with its reason. This is the part being approved.
- **Also changed** — the contracts, docs and rules that move with it.
- **Deliberately out** — what you are not doing, so scope creep is visible.

Plus a diagram (§5). Then `scripts/status.sh set <n> planning` and **stop**.
Say in your reply that it is waiting on the human's approval.

### Track C

The issue is an epic. Its body gets product requirements and a diagram — what
the initiative is for, what will be true at the end, the pieces and how they
fit — and **no implementation plan**, because each child gets its own.

Then create the children as native sub-issues:

```bash
child=$(gh issue create --title "…" --body "…" --label enhancement --json number --jq .number)
gh api repos/chpy04/resumix/issues/<n>/sub_issues -f sub_issue_id="$(gh api repos/chpy04/resumix/issues/$child --jq .id)"
scripts/status.sh set "$child" backlog
```

Each child is one PR's worth of work, and each is left in `status:backlog` for
its own `/triage` later. **Do not plan them here.** Then
`scripts/status.sh set <n> planning` and stop.

## 4. Where the plan goes

Into the **issue body**, fenced by markers, below whatever the human wrote:

```
<!-- resumix:plan planned=2026-09-19T20:31:00Z -->
## Plan
…
<!-- /resumix:plan -->
```

The `planned=` timestamp is load-bearing — it is what a re-plan (§7) uses to
tell feedback from the discussion that preceded the plan. Use
`date -u +%Y-%m-%dT%H:%M:%SZ`.

Read the body, keep everything above `<!-- resumix:plan -->`, and replace
anything between the markers. A re-plan then _replaces_ the old one instead of
burying it three comments deep, and the human's original report is never
touched.

```bash
gh issue view <n> --json body -q .body   # read, split on the marker
gh issue edit <n> --body-file <file>     # write back
```

## 5. Diagrams (Track B and C)

Use the Excalidraw MCP. One scene per issue, in the `plans` collection:

1. `list_collections` → find `plans`; `create_collection` if it is missing.
2. `create_collection_scene` with name `#<n> — <issue title>`.
3. `read_diagram_format` — the server requires it before the first write.
4. `create_diagram` with semantic nodes and edges.
5. `take_screenshot` and **look at it**. Overlapping labels and 8:1 aspect
   ratios are normal on the first attempt; fix them before linking it.
6. Link it in the plan as
   `https://app.excalidraw.com/s/<workspaceId>/<sceneId>` — the workspace id
   comes back on every scene's metadata, and that `/s/` path is the app's
   real scene route. Get it wrong and the link opens an empty editor rather
   than failing, so paste it once and check it loads.

Draw the **shape of the change**, at the altitude a human reviews at:

- the primary flow — what calls what, in what order
- any schema change: which tables are new, which gain columns, how they
  relate. Table names and relationships, not every column and type.

Two things that will bite you. `create_diagram` lays out one chain per layer,
so a long linear flow comes out 1:4 or worse — make board states the nodes and
put the actors on the edges rather than alternating them. And antiparallel
edges land both labels on the same midpoint, so label at most one of them.

## 6. Ask the human only when the answer changes the plan

Use `AskUserQuestion` when a single decision would rewrite everything
downstream — an abstracted versus concrete table, one endpoint versus three,
a new dependency versus hand-rolling it. Give a recommendation as the first
option.

Do not ask about anything you can decide and state. "Which shade of grey",
"should I also update the docs", "is this okay" — decide, write it in **Key
decisions**, and let the human overrule it at the gate. That gate is what the
question would have been.

## 7. Re-planning: answering feedback on a plan you already wrote

An issue sitting in `status:planning` is waiting on a human. When that human
has responded with feedback rather than approval, `/triage` is pointed at it
again to answer them.

### Find what is new

The opening marker records when the plan was written:

```
<!-- resumix:plan planned=2026-09-19T20:31:00Z -->
```

Feedback is anything that arrived after that timestamp, from two places:

**Issue comments.**

```bash
gh issue view <n> --json comments \
  --jq '.comments[] | select(.createdAt > "<planned>") | {author: .author.login, body}'
```

**Annotations on the diagram.** Excalidraw's own comment feature is not
reachable — comments live on a different host behind a browser session, and
the API the MCP wraps has no endpoint for them. So canvas feedback arrives as
ordinary scene elements: a sticky note or a text box dropped on the diagram.
Read them with `search_scene_content` or `get_scene_content` and treat every
standalone text element that is not one of your own node or edge labels as a
note to you.

If both come back empty, say so and stop. Do not rewrite a plan nobody
questioned.

### Answer every piece of it

Each note is exactly one of three things, the same as a code review:

- **Take it.** Change the plan. Say what you changed.
- **Push back.** You think it is wrong, or it breaks something they cannot see
  from the plan — an invariant, a contract, a D-number. Say so, with the
  reason, and leave the decision to them. Do not quietly comply with a change
  you believe is wrong.
- **Out of scope.** A real point that belongs to a different issue. Say that
  plainly rather than absorbing it.

### Write it back

Rewrite the plan between the markers with a fresh `planned=` timestamp, and
regenerate the diagram if any of the feedback touched it — `create_diagram`
with `clearExisting: true`, which also clears the annotations now that they are
answered.

Then post **one** issue comment summarising what you did with each piece of
feedback: taken, pushed back on (and why), or deferred. That comment is how
the human sees they were heard without diffing two versions of a plan.

Leave the issue in `status:planning`. It is still waiting on the same human,
who now has your answers.

## Length

**Never a wall of text.** A Track B plan is tens of lines, not hundreds. If
what you are writing does not fit, that is the signal it is an epic, not a
signal to keep typing.

Leave out edge cases, error handling, naming, and anything a competent
implementer will work out. Those belong to `/implement`. What only you can
supply is the shape: the requirements and the handful of decisions a human
might want to reverse. Write it for a reader who has not seen the code.
