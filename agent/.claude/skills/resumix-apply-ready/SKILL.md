---
name: resumix-apply-ready
description: Work through every Ready application in Resumix, one at a time, best fit first. For each one it follows /resumix-apply's steps, filling the form with exactly what Chris approved and stopping before Submit, then asks Chris before starting the next. It never submits a form and never moves on by itself. Invoked by hand as /resumix-apply-ready.
disable-model-invocation: true
---

# /resumix-apply-ready: every Ready application, one at a time

You apply to each application Chris has approved, one after another (R13).
Each one is a whole `/resumix-apply` run, with its own stop before Submit
and its own answer from Chris. **You never start the next application
until Chris says so.** The hard rules at the end hold throughout.

## 1. Check the connection

Call `mcp__resumix__ping`. If it fails, or `resumix` is missing from your
tools, stop and tell Chris (agent/CLAUDE.md).

## 2. List what is Ready

Call `mcp__resumix__list_applications` with `{ "status": "ready" }`.

- **`[]`:** say "Nothing is Ready." and stop.
- **Otherwise:** sort by `fit_score`, highest first, an application with no
  score last, as the Needs review column orders them. Show the list, one
  line each: company, role and fit.

## 3. Ask before the first

Ask: "Start with <company> · <role>? (yes / skip / stop)", and wait.

- **yes:** go to step 4 with it.
- **skip:** leave it Ready, and ask the same about the next one.
- **stop:** go to step 6.

## 4. Apply to one

Read `.claude/skills/resumix-apply/SKILL.md`, and follow its steps 0 to 7,
its unseen-field section and its hard rules, with this application's
`application_id` as the argument.

- **Its packet is refused** (Chris reopened it, or it was sent since the
  list was read): skip it, giving the refusal's reason, and go on.
- Everything that skill stops on, it stops on here: a gate, a question to
  Chris, a field nobody has seen.

## 5. Between applications

When one ends (applied, back in Needs review, not sent, or stopped), give
one line: `<company>: <how it ended>`. Then, if any are left, ask "Next:
<company> · <role>. Go on? (yes / skip / stop)", and wait. Act on the
answer as in step 3.

**Never start the next application on your own,** however the last one
ended, and never two at once: the browser holds one form at a time, and
each stop before Submit is Chris's.

## 6. Summary

In chat, and nowhere else: how many, and which, were applied, sent back
to Needs review (with the fields reported), skipped, and still Ready.

## Hard rules

- **Never submit.** Never click "Submit", "Send", "Finish", "Complete" or
  "Confirm", nor "Apply" once the form is open. Never press Enter
  (`mcp__playwright__browser_press_key`), and never set `submit` on
  `mcp__playwright__browser_type`. Never accept a dialog that confirms
  sending (`mcp__playwright__browser_handle_dialog`). Never call
  `mcp__playwright__browser_evaluate` or
  `mcp__playwright__browser_run_code_unsafe`: either can send a form in
  code. If you are not sure whether a control sends the form, ask Chris.
  He submits, at apply.
- **Every hard rule in `.claude/skills/resumix-apply/SKILL.md` holds for
  every application.**
- **`mcp__resumix__mark_applied` only after Chris says "submitted" about
  that application.** An answer about one never carries over to the next.
