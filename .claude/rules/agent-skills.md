---
paths:
  - 'agent/**'
---

# The applying Claude's skills

For the Claude that builds Resumix. (If you are the Claude in `agent/` that
applies to jobs, this file is not for you, and `agent/CLAUDE.md` wins.)

`agent/` is the applying Claude's workspace, against production (D-038).
You write its files and never run them: no `claude` in `agent/`, no
`./claude.sh`, no skill (C8). So everything here is checked statically, by
`lib/agent-skills.test.ts`, whose failure messages point here.

## Skills

- One per directory: `agent/.claude/skills/<name>/SKILL.md`, with `name`
  equal to `<name>` and a non-empty `description`.
- **Every frontmatter key fits on one `key: value` line.** The test parses
  them one line at a time, because a YAML parser would be a dependency.
- A skill that writes to Resumix is `disable-model-invocation: true`, so it
  runs only when Chris types it, and no `allowed-tools` pre-approves a
  Resumix tool: every production write is one he approves (D-038).
- A pasted posting is the argument, so a skill reads `$ARGUMENTS` whole and
  declares no named `arguments:`, which would split it on whitespace.
- **Resumix tools are written `mcp__resumix__<name>`,** the name the model
  sees, and never bare. A name may appear only once it is in `TOOLS`
  (`lib/mcp/tools/index.ts`), which is what `tools/list` serves; land the
  tool first. The test fails on both: on any `mcp__resumix__` name not in
  `TOOLS`, on a `TOOLS` name written bare, and in a skill on a code span
  opening with a tool-like name (`get_`, `set_`, `list_`, `create_`,
  `update_`, `delete_`, `add_`, `suggest_`, `submit_`, `mark_` or `report_`)
  that `TOOLS` lacks. Reword a non-tool identifier rather than weaken it.
- A skill chooses and orders library content. It never writes to the
  library, and nothing in `agent/` may tell the model to: the tools that
  would are on the NOT EXPOSED list in `.claude/rules/mcp.md`. The only
  resume text it proposes goes through `mcp__resumix__suggest_bullet`, which
  Chris applies or rejects in review (D-045).
- **Playwright tools are written `mcp__playwright__<name>`,** never bare in
  a skill, and only from `PLAYWRIGHT_TOOLS` in the test: the default tools
  of the `@playwright/mcp` version `agent/.mcp.json` pins (core automation
  and tabs; the rest need a `--caps` flag it does not pass). Bumping the
  version fails the test until that list is checked against the new
  README.

## Forms

`/resumix-propose` walks an application form to record its questions, and
the apply pass fills it. Both read a question's `field_ref` the same way
(D-049):

- `page` counts the form's pages from 0, as `add_questions` does. Sign-in
  screens and "how do you want to apply" choices are not pages.
- `label` is the visible label exactly, minus required markers, and scoped
  to its block in a repeated "Add another" block, as in
  `Work experience 1: Job title`, so two blocks never share a `field_ref`.
- `selector` is a Playwright role selector built from the snapshot
  (`role=textbox[name="…"]`), which a tool's `target` accepts, or null.
  Never a snapshot ref such as `e23`: refs change with every snapshot.

**No skill submits a form; Chris does.** The propose skill's hard rules
carry a `**Never submit` rule that bans clicking "Submit", pressing Enter
(`browser_press_key`), setting `submit` on `browser_type`, and
`browser_evaluate` and `browser_run_code_unsafe`, either of which can
submit in code. No skill may contain `submit: true`. The test pins each of
these against deletion; only the eval's live-form case can show the skill
obeys them.

## The career-ops routing

career-ops hands its CV, cover-letter and tracker steps to Resumix through
its own house rules, `$CAREER_OPS_DATA_DIR/modes/_custom.md` (D-043). That
file is gitignored and partly Chris's, so the committed text is one block in
`agent/career-ops-custom.md`, between a `<!-- resumix-routing:begin` line and
a `<!-- resumix-routing:end -->` line, and nothing else.

`agent/install-career-ops-custom.sh` writes that block in, replacing only the
lines between the markers. `./claude.sh` runs it at every launch and
`/resumix-propose` at every run. Keep it bash 3.2 and BSD awk, and tracked as
mode 100755. Never point it at the submodule: career-ops reads user files
from its data root, and `agent/career-ops/` stays untouched.

## The eval

`agent/evals/propose.md` is how Chris accepts `/resumix-propose`, by hand,
after a deploy: four `## Case` sections, each a fenced posting and a
`- [ ]` checklist, plus a `## Discovery checklist` of `- [ ]` items for any
run that finds a form. Cases 1–3 are pasted postings with no form behind
them; Case 4 is a live multi-page form. Change it in the same commit as the
skill.
