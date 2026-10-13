<!-- resumix-routing:begin
     Installed into $CAREER_OPS_DATA_DIR/modes/_custom.md from
     agent/career-ops-custom.md by agent/install-career-ops-custom.sh, at
     every ./claude.sh launch and every /resumix-propose run. Everything from
     this line to the end marker is replaced each time, so an edit inside it
     is lost. Put your own house rules above or below it. -->

## House Rules: Resumix routing

Resumix makes Chris's resumes and cover letters, and tracks the jobs he
applies to, through the `resumix` MCP server. career-ops finds and
evaluates postings. These rules hand every CV, cover-letter and tracker step
to Resumix, in every mode, and win over a mode's default (and over
`_shared.md`'s "register in tracker" rule) where the two disagree. They are
procedural only and add no fact about the candidate.

### Resumes

- Never generate, tailor or render a CV, in any format. That rules out the
  `pdf`, `latex`, `latex-tex` and `text` modes, `auto-pipeline` Step 3 and
  `pipeline`'s CV step (the same step), and `batch`'s tailoring.
- Never edit `cv.md` for a posting. It is read for evaluation and nothing
  else.
- When a mode reaches a CV step, skip it. Write
  `**PDF:** pending, made in Resumix` in the report header, mark the PDF ❌
  in any tracker row or summary table, and tell Chris to run
  `/resumix-propose <posting URL>`.

### Cover letters

- Skip `oferta`'s "Cover Letter Draft" section: append no draft to the
  report.
- Never run the `cover` mode.
- Resumix drafts cover letters, and only when an application form asks for
  one as a file.

### Tracker

- Never run `set-status.mjs`. Once a job is in Resumix, its status lives
  there.
- During `/resumix-propose`, skip `oferta`'s "Record in tracker" step. Write
  no `data/applications.md` row and no `batch/tracker-additions/` TSV, and
  never run `merge-tracker.mjs`: Resumix is the tracker from the moment the
  application is created there. Save the report as usual.

## Off-Limits: Resumix routing

Never run these scripts, whatever a mode says:

- `generate-pdf.mjs`, `generate-latex.mjs`, `build-cv-html.mjs`,
  `build-cv-latex.mjs`, `batch-tailor.mjs`, `openai-tailor.mjs` and
  `patch-latex-content.mjs`, which make or rewrite a CV.
- `generate-cover-letter.mjs`, which makes a cover letter.
- `set-status.mjs`, which changes a tracked status.

<!-- resumix-routing:end -->
