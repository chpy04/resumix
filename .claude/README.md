# `.claude/`

Checked-in configuration for agents working in this repo.

- **`rules/*.md`** — the conventions, one file per area. Each has a `paths`
  frontmatter glob and is loaded only when Claude touches a matching file, so
  none of it costs context on unrelated work. `CLAUDE.md` at the repo root
  carries the always-loaded half: what the app is, the five silent
  invariants, and the merge gate.
- **`skills/implement/SKILL.md`** — the unattended pipeline. `/implement <n>`
  takes one issue from backlog to an open PR, acting as an orchestrator. A
  `plan-first` issue stops at a plan on the Excalidraw board first. It
  is `disable-model-invocation: true`, so only a typed slash command (or
  `scripts/herd.sh`) starts it. Unlike `rules/`, a skill is a _procedure_
  rather than a convention: it costs no context until someone asks for it.
- **`agents/*.md`** — the three subagents `/implement` delegates to:
  `planner` (read-only, writes the plan), `implementer` (builds and commits
  in the worktree), and `verifier` (read-only, checks the diff against the
  ticket and plan and runs the gate). The orchestrator judges their output
  and never writes code itself. See `rules/github.md` for the lifecycle.
- **`settings.json`** — permissions. The `allow` half lists the project's own
  read-only and verification commands, so the merge gate can be run without a
  prompt per step. The `deny` half is a hard boundary, not a convenience: the
  production instance (`npm run deploy:prod`, `docker-compose.prod.yml`,
  `~/.resumix/`) and `.env` files are off-limits, and so are the parts of
  `agent/` that belong to the Claude that applies to jobs: its launcher
  `agent/claude.sh`, its browser profile and the career-ops submodule
  (D-038). `scripts/deploy-prod.sh`
  refuses independently when `CLAUDECODE` is set, so neither half is the only
  thing standing between an agent and real data — see CLAUDE.md, "Production
  is not yours".

The mechanical half of these rules is enforced by `eslint.config.mjs`, whose
error messages name the rule file that explains them. Prose and lint config
are meant to agree — if you change one, change the other.
