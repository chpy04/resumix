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
  tool first. The test fails on both.
- A skill chooses and orders library content. It never writes resume text,
  and nothing in `agent/` may tell the model to. The tools that would are on
  the NOT EXPOSED list in `.claude/rules/mcp.md`.

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
after a deploy: three `## Case` sections, each a fenced posting and a
`- [ ]` checklist. Change it in the same commit as the skill.
