# Final review

_2026-09-18, by the orchestrating agent. Reviewed after all twelve tasks merged._

A dedicated review agent was spawned for this pass and was **terminated mid-run by an
automated cyber-safeguard false positive** — the brief asked it to audit token
verification, middleware coverage and LaTeX handling, which tripped a filter despite
being ordinary defensive review of this repo's own code. The review below was therefore
done directly. It is narrower than the one that was planned: it covers the highest-risk
paths listed in that brief, not a line-by-line sweep of all 97 source files.

## Verdict

No critical or high-severity defects found in the areas examined. One low-severity
hardening issue was found and fixed. Three sharp edges are documented below as things to
know rather than things to fix.

## Fixed in this pass

### LOW — `PDF_NAME_PREFIX` reached the `Content-Disposition` header unsanitized

`lib/filename.ts` normalized the company portion of the filename but interpolated the
prefix verbatim, and `app/api/resumes/[id]/pdf/route.ts` interpolated the stored filename
straight into `attachment; filename="..."`. The prefix is operator-supplied, not
user-supplied, so this was not exploitable by a visitor — but a stray `"` in the env var
would truncate the header and produce a wrong download filename.
**Fixed**: `sanitizeForHeader()` strips quotes, backslashes and control characters
(including CR/LF) from both the prefix and the header value.

## Verified sound

- **Autosave coalescing** (`lib/editor/autosave.ts`). Exactly one `save()` in flight per
  queue; a `schedule()` during a flight replaces the pending value rather than queuing a
  backlog or racing a parallel request; the `finally` hand-off sends the latest value
  afterwards. Failures set `'error'`, retain the value for `retry()`, and are never hidden
  by a later unrelated success (`combineStatuses` prioritizes `saving` > `error` > `saved`).
- **Selections replace** (`lib/queries/selections.ts`). Delete-then-insert per slice inside
  one transaction; every id is validated to exist, and nested ids are validated to belong to
  the parent they are nested under, _before_ any write. Confirmed live:
  a dangling id returns `400 unknown experience id(s): …`, and a bullet placed under the
  wrong experience returns `400 … does not belong to experience …`.
- **`sort_order` scoping.** Nested slices index per parent, matching `docs/SCHEMA.md`.
  Duplicate values across different parents are expected and harmless — the bridge PK is
  `(resume_id, child_id)`, not `(resume_id, sort_order)`.
- **Auth coverage.** `middleware.ts` matches `/api/:path*` and exempts only `/api/auth`, so
  every mutating route is behind the gate. Confirmed live: `GET /api/resumes` without a
  token returns 401.
- **Single-default invariants.** Confirmed live: `DELETE` on the default resume returns 400,
  and inserting a second `is_default = true` resume directly in SQL is rejected by
  `ux_resume_one_default`.
- **Anti-drift.** Confirmed live and in e2e: after editing a bullet, a fresh render changes
  while the saved snapshot's bytes are unchanged (identical md5).
- **Latex sidecar auth.** Confirmed live: `/health` 200 without a token, `/compile` 401
  without and with a wrong token, 200 with the right one.

## Sharp edges — known, not defects

### MEDIUM (design) — a partial nested-slice map silently deselects the other parents

`replaceExperienceBullets` (and its project/skill twins) deletes **all** of the resume's
rows for that slice and reinserts only what the request contained. Sending
`{"experienceBullets": {"exp-1": [...]}}` therefore wipes every other experience's bullet
selections. This is the documented wholesale-replace contract (D-007), and the editor does
send the full map (`ResumeEditor.tsx` passes `next[slice]`, the entire record) — but it is a
trap for any future caller that assumes a patch-style merge. Worth a guard or a
`?mode=merge` variant if a second client is ever written.

### LOW — the latex service's `/health` is unauthenticated by design

Needed so Fly/Docker health checks work without distributing the token. It returns a
constant and touches nothing, so the exposure is that an unauthenticated caller can learn
the service exists.

### LOW — `combineStatuses` reports `'saved'` if _any_ channel has ever saved

With several independent queues, a channel sitting at `'idle'` is invisible once another has
saved. Correct for the indicator's purpose ("is there unsaved work or a failure?") but it is
not a per-channel status.

## Not verified

- No load or concurrency testing. Single-user by design; two browser tabs editing the same
  resume simultaneously would last-writer-wins, which has not been exercised.
- The multi-page (`pages > 1`) warning badge has never been seen against real content — the
  seeded resume is one page. Flagged by T9 as well.
- Deployment to Supabase / Fly.io / Vercel is written but unexecuted; no credentials exist in
  this environment. `docs/DEPLOYMENT.md` marks those steps accordingly.
- No line-by-line sweep of the React component tree for accessibility or rendering edge cases.
