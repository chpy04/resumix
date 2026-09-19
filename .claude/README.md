# `.claude/`

Checked-in configuration for agents working in this repo.

- **`rules/*.md`** — the conventions, one file per area. Each has a `paths`
  frontmatter glob and is loaded only when Claude touches a matching file, so
  none of it costs context on unrelated work. `CLAUDE.md` at the repo root
  carries the always-loaded half: what the app is, the four silent
  invariants, and the merge gate.
- **`skills/*/SKILL.md`** — one per phase of the task lifecycle: `triage`,
  `implement`, `review-pr`. A human invokes each by hand (`/triage 42`), and
  they deliberately never invoke each other — a phase boundary is a human
  decision. Unlike `rules/`, a skill is a _procedure_ rather than a
  convention: it costs no context until someone asks for it.
- **`settings.json`** — permission allowlist for the project's own read-only
  and verification commands, so the gate can be run without a prompt per
  step.

The mechanical half of these rules is enforced by `eslint.config.mjs`, whose
error messages name the rule file that explains them. Prose and lint config
are meant to agree — if you change one, change the other.
