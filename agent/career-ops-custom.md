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
- `/resumix-propose` drafts the letter in Resumix when the application form
  asks for one, as a file or in a text box.

### Tracker

Resumix is the tracker of record for every job it holds (D10). A job is in
Resumix once `mcp__resumix__create_application` has run for it. Before any
tracker step, in any mode, look it up: call
`mcp__resumix__list_applications` with `{ "posting_url": <its URL> }`, the
URL with every `utm_*` parameter and the `#fragment` removed. Any match
means the job is in Resumix.

- For a job in Resumix: write no `data/applications.md` row, no
  `batch/tracker-additions/` TSV and no `status-log.tsv` line, and never
  run `merge-tracker.mjs`, `set-status.mjs`, `outcome.mjs` or
  `followup-seed.mjs` for it. Its status lives in Resumix. Save reports as
  usual.
- Never run the `apply` mode for a job in Resumix: its last step marks the
  job Applied in career-ops' tracker. Tell Chris to approve it in Resumix
  and run `/resumix-apply <application_id>`, which fills the form with
  what he approved.
- During `/resumix-propose`, skip `oferta`'s "Record in tracker" step:
  Resumix is the tracker from the moment the application is created there.
- Never run `set-status.mjs`, for any job.
- `scan`, `triage` and `pipeline.md` stay career-ops' inbox, for postings
  not yet in Resumix (R14).

## Off-Limits: Resumix routing

Never run these scripts, whatever a mode says:

- `generate-pdf.mjs`, `generate-latex.mjs`, `build-cv-html.mjs`,
  `build-cv-latex.mjs`, `batch-tailor.mjs`, `openai-tailor.mjs` and
  `patch-latex-content.mjs`, which make or rewrite a CV.
- `generate-cover-letter.mjs`, which makes a cover letter.
- `set-status.mjs`, which changes a tracked status.

<!-- resumix-routing:end -->
