---
paths:
  - 'lib/render/**'
  - 'lib/latex.ts'
  - 'lib/seed-data/**'
  - 'services/latex/**'
  - 'scripts/smoke.ts'
---

# Render engine and the LaTeX sidecar

`docs/TEMPLATE_TOKENS.md` is the contract for token syntax.

## Content is raw, unescaped LaTeX

Bullets legitimately contain `\textbf{}`, `\href{}{}`, `\$`, `\&`. The user
is authoring LaTeX; the renderer substitutes **verbatim**. Never add
auto-escaping — it would corrupt every existing bullet (D-008). This is the
single easiest invariant in the repo to break "helpfully".

## `renderResume()` is pure

No I/O, no `lib/db` import, no `async`. It takes a template string plus a
library and selections and returns `{ tex, warnings }`. That is what makes
it exhaustively unit-testable in `lib/render/render.test.ts`, and why
`lib/queries/render.ts` (which does the loading) is a separate module.

## Never throw on bad data

A dangling id, a zero-bullet item, an unknown token: push a string onto the
`warnings` array and carry on. A stale id must never blank the preview. The
`warnings` out-parameter threaded through `sections.ts` is the established
pattern — keep it.

## An empty section is a fatal LaTeX error

`\begin{itemize}` with no `\item` aborts the compile. Deselecting a whole
section is a normal tailoring action, so every section in the default
template is wrapped in `<<IF:TOKEN>> … <<ENDIF>>`, which drops the block —
heading included — when the token expands to nothing (D-016). Conditionals
resolve _before_ plain substitution. They are deliberately not nestable.

Any new section token needs the same wrapper, and `scripts/smoke.ts`
asserts every section can be emptied independently.

## A compile failure is a result, not an exception

`compileTex()` returns `{ ok: false }` for a LaTeX error and throws
`LatexServiceError` only when the service itself was unreachable,
misconfigured, or timed out. Keep those two cases distinct all the way up.

## The smoke test is the acceptance bar

`npm run smoke` reads the seeded Default resume back out of the database,
renders it, diffs against `docs/reference/v1-resume.tex` byte-for-byte
(whitespace-normalized), and compiles it through the real `pdflatex`
sidecar expecting one page. "I can always represent my current resume" is
the project's governing constraint — any schema or renderer change must
keep this green.

It reads live DB state, so run `npm run db:seed -- --force` first. A
previous Playwright run leaves edited content behind and the round-trip
diff will fail for reasons that have nothing to do with your change.

## The sidecar

`services/latex/` is dependency-free CommonJS Node on TeX Live — no Express,
no TypeScript, no bundler. Keep it that way; it is a container that has to
stay small and auditable. It runs non-root with `-no-shell-escape`, a 20s
timeout and bounded concurrency, and requires a bearer token on `/compile`
because it has a public IP on Fly and LaTeX can read files on its box
(D-015). `/health` stays open.
