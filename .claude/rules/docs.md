---
paths: 'docs/**'
---

# Documentation

## `docs/` is present tense

Everything here describes **what exists right now**. Not what is planned, not
what is in flight, not what a past task did — that all lives on the GitHub
board (see the task lifecycle in `CLAUDE.md`). A sentence in `docs/` that
would need rewording the moment a PR merges is a sentence that belongs in an
issue instead.

The practical test: if a line contains "currently", "so far", "next up", a
task id, or a date, it is tracking progress, and progress is not tracked here.

## Three of these are contracts

`docs/SCHEMA.md`, `docs/API.md` and `docs/TEMPLATE_TOKENS.md` define the
database shape, the HTTP interface and the template token grammar. Other
code — and other agents — rely on them being accurate. They are not notes.

- Update the contract in the **same commit** as the code that changes it,
  never afterwards.
- If reality and a contract disagree, that is a bug in one of them. Decide
  which, fix it deliberately, and say so. Do not paper over it.
- If an issue's approved plan declares a contract frozen, propose the change
  in a comment on that issue instead of making it.

## The rest

- `docs/STATE.md` — read first when picking the project up cold. A
  description of the system as it stands, not a changelog. Update it when a
  change made something in it untrue; don't append to it to record that work
  happened.
- `docs/DECISIONS.md` — append-only. A decision gets a D-number, a
  rationale, and the alternatives that were rejected and why. Add one when
  you make a choice a future reader would otherwise want to reverse.
- `docs/ARCHITECTURE.md` — the shape of the system and why each piece was
  chosen.
- `docs/CONTRIBUTING.md` — the how-to for migrations, endpoints, the gate.

The history of _how_ the code got this way is in the git log and in the
issue and PR that carried each change. Don't recreate it here.

## Style

Explain _why_, not _what_ — the code already says what. A doc line a fresh
session could reconstruct by running `ls` or reading `package.json` is
dead weight; delete it rather than maintain it.
