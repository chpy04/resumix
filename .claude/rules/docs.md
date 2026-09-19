---
paths: 'docs/**'
---

# Documentation

## Three of these are contracts

`docs/SCHEMA.md`, `docs/API.md` and `docs/TEMPLATE_TOKENS.md` define the
database shape, the HTTP interface and the template token grammar. Other
code — and other agents — rely on them being accurate. They are not notes.

- Update the contract in the **same commit** as the code that changes it,
  never afterwards.
- If reality and a contract disagree, that is a bug in one of them. Decide
  which, fix it deliberately, and say so. Do not paper over it.
- During a task or wave that declares contracts frozen (see
  `docs/WORKPLAN.md`), propose the change instead of making it.

## The rest

- `docs/STATE.md` — read first when picking the project up cold. Every
  merged change updates it.
- `docs/DECISIONS.md` — append-only. A decision gets a D-number, a
  rationale, and the alternatives that were rejected and why. Add one when
  you make a choice a future reader would otherwise want to reverse.
- `docs/ARCHITECTURE.md` — the shape of the system and why each piece was
  chosen.
- `docs/CONTRIBUTING.md` — the how-to for migrations, endpoints, the gate.
- `docs/agents/<task-id>.md` — historical per-task reports. **Append-only
  archive**; do not edit or reformat them (Prettier skips the directory).

## Style

Explain _why_, not _what_ — the code already says what. A doc line a fresh
session could reconstruct by running `ls` or reading `package.json` is
dead weight; delete it rather than maintain it.
