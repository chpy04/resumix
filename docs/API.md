# API contract

All routes live under `app/api/**/route.ts`. All are server-side and require a
session except `POST /api/auth`, and `/api/mcp/**`, which requires an API token
instead (see "API tokens" below).

**Everything is scoped to the caller.** Every handler resolves a user via
`requireUserId(request)` (`requireMcpUserId` under `/api/mcp/**`) and passes
that id to the query layer; there is no
ambient "current user" and no query runs without one. An id belonging to
somebody else is answered exactly as a nonexistent one — `404` for a lookup,
`400 unknown ... id` for a reference — never `403`, which would confirm the
id is real.

## Auth modes

Selected by `RESUMIX_AUTH_MODE`, defaulting to `dev` outside production and
`password` in production (see `lib/auth-mode.ts`).

| mode       | how the caller is identified                                                                     | when                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `dev`      | **no login at all** — the session is the first row in `users`, the one `npm run db:seed` creates | local development                                                           |
| `password` | shared `APP_PASSWORD` → HMAC token naming one user, sent as `x-resumix-token`                    | today's only non-local path                                                 |
| `supabase` | Supabase OAuth JWT → `users.supabase_user_id`                                                    | **not implemented**; the seam is `lib/auth-supabase.ts`, which fails closed |

In `password` mode the token is minted for `OWNER_EMAIL`, or for the only user
in the table if that is unset. With several users and no `OWNER_EMAIL`, login
is refused rather than guessed — one shared password cannot tell people apart.
That ambiguity is what Supabase OAuth exists to resolve.

**Auth header:** `x-resumix-token: <token>` (`password` mode only). The browser
keeps the token in `localStorage` under `resumix.token`. In `dev` mode there is
no token and no header.

**Errors:** `{ "error": "message" }` with 400 / 401 / 404 / 500.
**Casing:** JSON is `camelCase`; the DB is `snake_case`; Drizzle maps between them.

## Types (see `lib/types.ts`)

```ts
type Experience = { id; company; title; dateRange; location; isArchived; bullets: Bullet[] };
type Project = { id; name; technologies; dateRange; isArchived; bullets: Bullet[] };
type Bullet = { id; content; isArchived };
type SkillRow = { id; name; top; separator; isArchived; skills: Skill[] };
type Skill = { id; name; isArchived };
type Template = { id; name; content; isDefault; isArchived };

type ResumeSummary = {
  id;
  name;
  isDefault;
  templateId;
  createdAt;
  updatedAt;
  latestPdf: { filename; createdAt } | null;
};

// A selection is an ordered list of ids. Order in the array IS sort_order.
type Selections = {
  experiences: string[]; // experience ids
  experienceBullets: Record<string, string[]>; // experienceId -> bullet ids
  projects: string[];
  projectBullets: Record<string, string[]>;
  skillRows: string[];
  skills: Record<string, string[]>; // skillRowId -> skill ids
};

type CoverLetterSummary = { id; name; isDefault; isArchived; createdAt; updatedAt };
type CoverLetter = CoverLetterSummary & {
  content: string; // the whole LaTeX document, or the shell around its %%BODY%% line
  body: string | null; // the letter's prose, plain text; null when it is LaTeX only (D-046)
};

// The middle three are set only by the review flow; PATCH refuses them (D-041).
type ApplicationStatus =
  | 'draft'
  | 'proposing'
  | 'needs_review'
  | 'ready'
  | 'applied'
  | 'interviewing'
  | 'offered'
  | 'rejected';

type ApplicationSummary = {
  id;
  company;
  roleTitle;
  postingUrl;
  status: ApplicationStatus;
  appliedAt: string | null; // null until it first reaches applied or a later stage
  resumeId: string | null; // the live resume being tailored
  sentPdf: { filename; createdAt } | null; // the frozen snapshot that went out
  coverLetterId: string | null; // this application's own letter; no snapshot beside it
  fitScore: number | null; // the agent's 0.0–5.0 estimate; null when unscored
  isArchived;
  createdAt;
  updatedAt;
};

type ApplicationFile = { id; filename; contentType; byteSize; isArchived; createdAt };

// One question an application's form asks (D-047). An answer is a string,
// or the options picked for a multi question; a file answer is an
// ApplicationFile id, and an instruction is its words.
type AnswerValue = string | string[];
type ApplicationQuestion = {
  id;
  prompt;
  kind: 'text' | 'choice' | 'multi' | 'bool' | 'file' | 'letter';
  options: string[] | null; // choice and multi only
  fieldRef: { page: number; label: string; selector: string | null };
  required: boolean;
  isEeo: boolean; // answered only by Chris (C10)
  source: 'profile' | 'agent' | 'saved' | null; // who proposed it; null when nothing was
  answerMode: 'value' | 'instruction';
  proposedAnswer: AnswerValue | null;
  answer: AnswerValue | null;
  redraftNote: string | null; // set while Chris has asked the agent for a new draft
  savedAnswerId: string | null; // its live saved answer; null when none, or since archived
  approvedAt: string | null; // cleared by any change to the answer
};

// An answer Chris ticked "remember" on (D-048), for the agent to link to a
// later form's question. Never a file. The answer is decoded as above.
type SavedAnswer = {
  id;
  prompt; // the question's wording when it was first saved
  kind: 'text' | 'choice' | 'multi' | 'bool' | 'letter';
  answerMode: 'value' | 'instruction';
  answer: AnswerValue;
};

type ApplicationDetail = ApplicationSummary & {
  notes: string;
  jobDescription: string | null; // the posting's text, from the agent
  agentSummary: string | null; // the agent's evaluation, plain text
  proposedSelection: Selections | null; // the agent's pick (C7); null when it proposed none
  resumeApprovedAt: string | null; // the resume approved in review; cleared when it changes
  coverLetterApprovedAt: string | null; // the same for the letter
  approvedAt: string | null; // final approval, which made it ready; cleared with it
  pdfFilenames: { resume: string | null; coverLetter: string | null }; // what approval names the PDFs
  files: ApplicationFile[];
  questions: ApplicationQuestion[]; // in the order they were added
};
```

## Auth

| method | path           | body           | returns                                                     |
| ------ | -------------- | -------------- | ----------------------------------------------------------- |
| POST   | `/api/auth`    | `{ password }` | `{ token }` · 401 on mismatch · 400 outside `password` mode |
| GET    | `/api/session` | —              | `SessionInfo` = `{ user, mode }` · **401 = show the login** |

The browser calls `GET /api/session` on load rather than treating a stored
token as proof of a session: in `dev` mode there is no token at all, and the
answer is whichever user the seed created.

## API tokens (`/api/mcp/**`)

The agent's surface has its own credential, and it is the only one accepted
there (D-039):

```
Authorization: Bearer rmx_<43 base64url characters>
```

- **Every auth mode, `dev` included.** Middleware lets `/api/mcp/**` through
  and the handler checks the token against `api_token` (`requireMcpUserId`).
  There is no dev-mode bypass: with no token, `/api/mcp` is a `401` even where
  the rest of the app needs no login at all.
- A missing, malformed, unknown or revoked token is `401 { "error": "unauthorized" }`,
  the same body for all four, so a `401` never confirms that a token existed.
- `x-resumix-token` is ignored here. The password session cannot drive the
  agent surface.
- `rmx_` tokens are accepted nowhere else. Every other route reads only
  `x-resumix-token` in `password` mode, and nothing at all in `dev` mode.
- Every successful call stamps the token's `last_used_at`.

There is no HTTP endpoint for managing tokens. They are minted and revoked
from the command line:

```bash
TOKEN=$(npm run -s token:create -- --label laptop-agent [--email you@example.com])
npm run token:revoke -- <id> [--email you@example.com]
```

`token:create` writes only the secret to stdout, where it is shown once and
never again, and the token's id, label and owner to stderr. The owner is
`--email`, else `OWNER_EMAIL`, else the only user; with several users and
neither, both scripts refuse. Both act on whatever database `DATABASE_URL`
names, which is the dev one, through `.env`, unless you point them elsewhere.

## MCP (`/api/mcp`)

The agent's interface: the Model Context Protocol over its streamable-HTTP
transport, hand-rolled in `lib/mcp/` with no SDK (D-040), behind the API
token above.

| method | path       | body                     | returns                                                      |
| ------ | ---------- | ------------------------ | ------------------------------------------------------------ |
| POST   | `/api/mcp` | one JSON-RPC 2.0 message | its JSON-RPC response as `application/json`, or a bare `202` |
| GET    | `/api/mcp` | —                        | `405`, `Allow: POST`, once the token checks out              |

**Stateless.** One message per POST, one answer. No `Mcp-Session-Id` is
issued and one sent is ignored, no SSE stream is ever opened, and nothing
carries over between requests, so `tools/list` works without an `initialize`
first. `Accept` and `Content-Type` are not enforced; the answer is JSON
either way.

| status | when                                                                                                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | a request (it has an `id`). The body is its JSON-RPC result, or a `-32601` / `-32602` error                                                                                                                                |
| `202`  | a notification (no `id`), or a response from the client. Empty body                                                                                                                                                        |
| `400`  | the body is not JSON (`-32700`); it is a batch, i.e. an array (`-32600`); it is not a JSON-RPC 2.0 message, or its `id` is not a string or number (`-32600`); an `MCP-Protocol-Version` header is not supported (`-32600`) |
| `401`  | no live `rmx_` token: `{ "error": "unauthorized" }`, with no JSON-RPC envelope. MCP leaves auth to HTTP                                                                                                                    |
| `405`  | `GET`                                                                                                                                                                                                                      |

**Protocol versions:** `2025-11-25`, `2025-06-18` and `2025-03-26`.
`initialize` echoes the client's `protocolVersion` when it is one of these
and answers `2025-11-25` otherwise. Later requests carry the agreed version
in `MCP-Protocol-Version`; a request without the header is accepted.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": { "name": "example-client", "version": "1.0.0" }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "tools": { "listChanged": false } },
    "serverInfo": { "name": "resumix", "version": "0.1.0" },
    "instructions": "Resumix holds one person's resume library (…). Call ping first to check the connection."
  }
}
```

| method            | params                   | result                                                                       |
| ----------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `initialize`      | `{ protocolVersion, … }` | as above; no string `protocolVersion` is `-32602`                            |
| `ping`            | —                        | `{}`                                                                         |
| `tools/list`      | —                        | `{ tools: [{ name, description, inputSchema }] }`: every tool, no pagination |
| `tools/call`      | `{ name, arguments? }`   | a `ToolResult` (below); a malformed envelope or an unknown tool is `-32602`  |
| `notifications/…` | anything                 | nothing: `202`                                                               |

Any other method is `-32601`. The `ping` **method** is MCP's liveness check
and touches nothing. The `ping` **tool**, called through `tools/call`, is the
one that proves the token and the database work.

**A JSON-RPC error means the message was wrong; everything that goes wrong
inside a tool is a result.** A model reads tool results and can correct
itself from them, so a failing tool answers `200` with `isError: true`:

```ts
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: true };
```

- **Arguments that fail the tool's schema** list every problem as
  `path: message`, then "Fix the arguments and call again; tools/list has the
  schema." Unknown keys are rejected rather than dropped, so a typo such as
  `applicationId` is reported by name.
- **A missing row or a bad reference** from the query layer passes its
  message through.
- **Anything else** is "Resumix hit an internal error; retry once, then stop
  and tell Chris." The real error goes to the server log only.

`inputSchema` is JSON Schema generated from the tool's zod input, without
`$schema`, and is always `type: "object"`.

**Tool conventions (C1).** A tool that acts on an application takes
`application_id` and nothing the server can work out from it: Resumix
resolves that application's resume, cover letter and template itself.
Another user's id reads as not found, as everywhere else. A failing tool's
text says what the agent should do next. A description says when to call the
tool and what comes back.

### Tool reference

Every tool but `ping` answers one text item of compact JSON whose keys are
snake_case, like the arguments, so what one tool returns can be passed
straight back into another (D-042). Text from the library is plain: LaTeX
markup is stripped for display (`\textbf{x}` → `x`, `\$` → `$`), and the
stored content stays raw (D-008).

| tool                    | arguments                                                                                                                                                               | returns                                                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ping`                  | none                                                                                                                                                                    | the email of the account that owns the token, as text                                                                                                                                                                                                                                    |
| `get_library`           | none                                                                                                                                                                    | `{ experiences: [{ id, company, title, date_range, location, bullets: [{ id, text }] }], projects: [{ id, name, technologies, date_range, bullets }], skill_rows: [{ id, name, top, skills: [{ id, name }] }] }`: non-archived content only (C9), in library order (D-030); no templates |
| `get_saved_answers`     | none                                                                                                                                                                    | `[{ saved_answer_id, prompt, kind, answer_mode, answer }]`: Chris's saved answers that are not archived, oldest first; `[]` when there are none. `answer` is a `string[]` for a multi value                                                                                              |
| `list_applications`     | `{ status?, posting_url? }`: `status` is any application status; `posting_url` is matched exactly after trimming                                                        | `[{ application_id, company, role_title, posting_url, status, fit_score, created_at }]`, newest first; `[]` when none match. Archived applications are never listed                                                                                                                      |
| `get_application`       | `{ application_id }`                                                                                                                                                    | `{ application_id, company, role_title, posting_url, status, fit_score, job_description, agent_summary, selection, approval: { resume_approved_at, cover_letter_approved_at, approved_at }, questions }`. `selection` has `set_resume_selection`'s shape, or is null with no resume      |
| `get_apply_packet`      | `{ application_id }`                                                                                                                                                    | `{ application_id, status: "ready", company, role_title, posting_url, approved_at, resume, cover_letter, questions }`: Ready only. `resume` and `cover_letter` (null with no letter) are `{ filename, url }`, `url` a path under `/api/mcp/files/`; `questions` below                    |
| `create_application`    | `{ company, role_title, posting_url, job_description, agent_summary, fit_score }`, all required: non-empty trimmed text, an http(s) URL, 0.0–5.0 with one decimal place | `{ application_id, status: "proposing" }`. The application holds a copy of Default named after the company. Not idempotent: the agent is told to call `list_applications({ posting_url })` first                                                                                         |
| `add_questions`         | `{ application_id, questions: [{ field_ref, prompt, kind, options?, required, is_eeo?, source?, answer_mode?, proposed_answer?, saved_answer_id? }] }`                  | `{ questions: [{ question_id, outcome, note? }] }`, in input order: `outcome` is `added`, `unchanged` or `redrafted`, and `note: "eeo_answer_dropped"` means a proposed EEO answer was dropped (C10)                                                                                     |
| `set_resume_selection`  | `{ application_id, selection: { experiences, experience_bullets, projects, project_bullets, skill_rows, skills } }`, all six required, every array in print order       | `{ ok, pages, overflow }`; `overflow` is null on one page, else `{ candidates: [{ id, kind, parent_id, parent, est_lines, text }], advice }`, at most five bullets to drop, best first                                                                                                   |
| `set_cover_letter_body` | `{ application_id, text }`: the whole letter as plain text, date line to sign-off, non-empty after trimming                                                             | `{ ok, pages }`; `ok` is `pages === 1`. `text` replaces the letter's `body`; an application with no letter is first given a copy of Default                                                                                                                                              |
| `submit_for_review`     | `{ application_id }`                                                                                                                                                    | `{ application_id, status: "needs_review", resume_pages, cover_letter_pages }`; `cover_letter_pages` is null when there is no letter                                                                                                                                                     |
| `report_question`       | `{ application_id, question }`: `question` in the shape `add_questions` takes                                                                                           | `{ question_id, outcome, note?, status: "needs_review" }`: the question is added, and a `ready` application goes back to `needs_review`                                                                                                                                                  |
| `mark_applied`          | `{ application_id }`                                                                                                                                                    | `{ application_id, status: "applied", applied_at, resume_filename }`: `ready` only; the PDF final approval pinned stays pinned                                                                                                                                                           |

An archived application reads exactly like a missing one, or another
user's: `No application <id>. Call list_applications to find its
application_id.`

**`get_application`**'s `questions` are the ones `add_questions` recorded, in
order: `[{ question_id, prompt, kind, options, field_ref, required, is_eeo,
source, answer_mode, proposed_answer, answer, approved_at, redraft_note }]`,
each shaped as in `ApplicationQuestion` (Types, above). `answer` is what will
be typed into the form, Chris's edits included. A non-null `redraft_note` is
Chris asking for a new draft of that answer, and says what to change.

**`add_questions`** records the questions an application's form asks, with
the answer the agent proposes for each (D-047). `field_ref` is `{ page,
label, selector? }`: the 0-based form page, the field's visible label, and an
optional selector hint. `kind` is `text`, `choice`,
`multi`, `bool`, `file` or `letter`; `options` lists a choice or multi
question's choices exactly as the form does. A `proposed_answer` comes with a
`source` (`profile` or `agent`) and fits its kind as `PATCH
/api/application-questions/:id` requires, or is an instruction
(`answer_mode: "instruction"`, choice and multi only).

- **Appends, de-duplicating on `field_ref`:** page plus label, case and
  whitespace folded. A question already recorded is `unchanged`, approved or
  not, and keeps the prompt, kind, options and answer it was first recorded
  with. The exception is one with a `redraft_note`: re-sent with a new
  `proposed_answer`, it is `redrafted`, the proposal replaces the answer and
  the note is cleared.
- **EEO (C10):** a question flagged `is_eeo`, or whose prompt names gender,
  sex, race, ethnicity, Hispanic or Latino origin, veteran status, disability,
  transgender or non-binary identity, pronouns, LGBT, or self-identification
  (`looksLikeEeo`), is recorded with no source and no answer, and a proposal
  on it is dropped, not refused (`note: "eeo_answer_dropped"`), with a source
  or without one. Chris
  answers it in review.
- **Refused, writing nothing, every problem listed:** two questions with the
  same `field_ref`; options missing on a choice or multi question, or present
  on another kind, or listed twice; a `proposed_answer` without a `source`, or
  the reverse, or an empty one; an instruction on anything but choice or
  multi; an answer that does not fit its kind; and any `proposed_answer` on a
  `file` question, which Chris answers by picking an attachment. The resume
  and cover letter upload fields are not questions; the apply packet uploads
  them.
- **Saved answers (D-048):** instead of a proposal, a question can carry the
  `saved_answer_id` of one of Chris's saved answers (`get_saved_answers`),
  sent alone: with `source`, `answer_mode` or `proposed_answer` beside it the
  call is refused. Resumix does no matching of its own (D15); the agent links
  one only when it plainly answers the question. A new question linked this
  way is `added` with `source: "saved"`, the saved answer's mode and answer
  copied in, and already approved, but still shown in review. It is the one
  way an EEO question arrives answered, since the answer is Chris's own
  (C10), so no note is added. A question already recorded ignores the link,
  except one with a `redraft_note`, which takes the saved answer and is
  `redrafted` but left unapproved, since Chris asked to see it again. An
  ordinary redraft of a question Chris remembered unlinks it
  (`savedAnswerId` becomes `null`): the agent's new words are not the saved
  answer, which stays as it was and live for other forms.
  `get_application` shows a linked question only by its `source`.
- **Refused, writing nothing, every problem listed, for a link:** an id that
  is not one of Chris's live saved answers (unknown, archived and another
  user's all read `no saved answer <id>`), and a saved answer that does not
  fit: a different kind (`text` and `letter` count as one), any `file`
  question, or a value that is not exactly one of this question's options.
  An instruction fits any choice or multi question.
- **Only while `proposing` or `needs_review`.** A `ready` application is
  refused (Chris has approved it), and so are drafts and sent ones. A
  question added to an application in review is one more thing to approve.

**`get_saved_answers`** lists what Chris ticked "remember this answer" on in
review. `kind` says how to read `answer`, which is encoded as in
`ApplicationQuestion`; it is never `file`. `prompt` is the wording the answer
was first saved under, and the same prompt may appear twice with different
answers: choosing between them is the agent's call.

**`set_resume_selection`** replaces the resume's whole selection, then
compiles it. `selection` is the API's `Selections` in snake_case:
`experience_bullets` maps an experience id to its bullet ids, `project_bullets`
and `skills` likewise.

- **Refused, writing nothing:** an application that has been sent (`applied`
  or later); one with no resume, or linked to the Default resume; and any id
  that is not in `get_library` (unknown, archived, or another user's), a
  bullet keyed under an item that is not selected or not its parent, or an id
  listed twice. The text lists every problem at once. These checks are the
  tool's own; autosave still accepts archived ids already on a resume (D-011).
- **`ok`** is `pages === 1`. More than one page is still a result, not an
  error: the selection is saved, and `overflow` ranks bullets to drop, last
  under its item first (the agent's order is its priority), then the longest,
  then the lowest on the page. An item's only bullet is never offered.
  `est_lines` is an estimate from the text's length.
- **`isError`, with the selection saved:** a LaTeX error, with its first three
  messages, or a sidecar that cannot be reached.
- **`proposed_selection`** (C7) is written too, but only while the
  application is `proposing`; each call then replaces the last.
- **In review**, it unapproves the resume like any other selection write, and
  a `ready` application goes back to `needs_review` (see "The review flow"
  under Applications).

**`set_cover_letter_body`** writes an application's cover letter as plain
text, then compiles it. `text` replaces the letter's `body`, which Resumix
escapes into the letter's `%%BODY%%` line (see Cover letters), so the agent
never writes LaTeX (D-046). With no letter linked, it first copies Default
onto the application, as `POST /api/applications/:id/cover-letter` does
(C12).

- **Refused, writing nothing and creating no letter:** an application that
  has been sent (`applied` or later); one linked to the Default letter; and a
  linked letter, or with none linked Default, without exactly one `%%BODY%%`
  line. That text tells the agent to stop and ask Chris to add the line.
- **`ok`** is `pages === 1`. A longer letter is still saved; the agent
  shortens the text and calls again.
- **`isError`, with the text saved:** a LaTeX error, with its first three
  messages (most often a character pdflatex cannot set, such as an emoji), or
  a sidecar that cannot be reached.
- **In review**, it unapproves the letter like any edit to its text, and a
  `ready` application goes back to `needs_review`.

**`submit_for_review`** hands the application to Chris: `proposing` becomes
`needs_review` (C3). It compiles the resume, and the cover letter if there is
one, and refuses while either is more than one page, naming the document and
its page count; the text says to trim with `set_resume_selection`, or, for the
letter, `set_cover_letter_body`. Also refused,
writing nothing: a `ready` application (already approved), a draft or sent
one, one with no resume, a document that does not compile (its first three
errors), and an unreachable sidecar (call again in a minute). Called on one
already in `needs_review`, it re-checks the pages and leaves it there.

**`get_apply_packet`** is what the apply pass fills into the real form:
exactly what Chris approved (C4, D-050). Refused, writing nothing, unless the
application is `ready`; each refusal says what to do (still proposing, in
Needs review with the path of its review page, already sent, or logged by
hand). A Ready application whose approved files cannot all be found (an
archived letter PDF, an archived attachment a `file` answer picked) is
refused too, telling the agent to have Chris approve it again. Its
`questions` are `[{ question_id, field_ref, prompt, kind, options, required,
is_eeo, approved, answer_mode, answer, file }]`.

- **Every question is listed**, in order. An approved one has its
  `answer_mode` and its decoded `answer`, as in `ApplicationQuestion`: an
  instruction's words, or a multi value's picks. An unapproved one (only an
  optional one can be, on a Ready application) has `answer_mode` and
  `answer` null, which means leave that field empty. It is still listed, so
  the apply pass knows the field and never reports it.
- **Files are paths, not absolute URLs.** `resume` is the pinned snapshot,
  `cover_letter` the PDF final approval stored, and an approved `file`
  question's `file` the attachment it picked, each `{ filename, url }`. The
  agent fetches `url` against the origin of its MCP URL, with the same token
  (Files for the agent, below).

**`report_question`** records a field the apply pass met that the packet
does not have (R12). `question` takes exactly `add_questions`' shape, and is
checked and recorded the same way, EEO included. Allowed while the
application is `ready` or `needs_review`, so every new field on a page is
reported before the agent stops: a `ready` application goes back to
`needs_review` with `approvedAt` cleared and its section approvals kept
(see "What reopens an approval"). A `field_ref` already recorded is refused,
writing nothing, since the packet has it; so are a proposing application
(which records with `add_questions`), a draft and a sent one.

**`mark_applied`** is called once Chris says he submitted the form himself:
`ready` becomes `applied` and `applied_at` is stamped, as `POST
/api/applications/:id/apply` does, keeping the PDF final approval pinned and
the letter's PDF. Any other status is refused, writing nothing: a sent one is
already done, and anything else changed after the packet was fetched, so the
agent tells Chris to mark it applied himself.

`npm run mcp:smoke` drives `initialize`, `tools/list` and the `ping` tool over
real HTTP against `npm run dev` (or `MCP_SMOKE_URL`, loopback only), with a
token it mints and revokes itself. It then reads the library, creates an
application, finds it with `list_applications` and `get_application`,
records two questions with `add_questions` (the EEO one's answer must be
dropped, a re-send must be `unchanged`, and `get_application` must list
both), remembers one in-process and finds it in `get_saved_answers`, links it
to a third question, which `get_application` must show as `source: "saved"`
and approved, while an unknown `saved_answer_id` must be refused with nothing
written, selects a small resume into it, which the real sidecar must compile to
one page, writes its cover letter with `set_cover_letter_body`, in text
holding every character the escaper replaces, which must also compile to one
page, twice into the same letter, and submits it for review, which
`get_application` must then show as `needs_review`; submitting an unknown id
must be `isError`. It then approves the application in-process, as Chris
would in review, with final approval compiling on the real sidecar, and
applies: `get_apply_packet` must list the approved answer and leave the
unapproved EEO one blank; both packet files must download over HTTP as PDFs
with the token, and be `401` without it and `404` for an unknown id;
`report_question` must send it back to `needs_review`, after which the packet
and its files are refused; and, approved again, `mark_applied` must make it
`applied`, once. The application and its letter are archived and the saved
answer archived when it ends; its resume is deleted only if no snapshot of it
was pinned, since a pinned one is the record of what was sent.
`npm run verify` runs it from `e2e/mcp.spec.ts`.

### Files for the agent (`/api/mcp/files/…`)

| method | path                                  | returns                                                          |
| ------ | ------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/mcp/files/resume-pdf/:id`       | the bytes of a Ready application's pinned `resume_pdf` snapshot  |
| GET    | `/api/mcp/files/application-file/:id` | the bytes of an attachment in a Ready application's apply packet |

These are the paths `get_apply_packet` returns, and the only way a file
reaches the agent: no tool returns bytes (C5, D-050).

- **The same token as `/api/mcp`**, checked first, in every auth mode. With
  no live `rmx_` token it is the same `401 { "error": "unauthorized" }`.
- **A live Ready application's packet, and nothing else.** A file is served
  while it is in the packet `get_apply_packet` would return now: the pinned
  resume PDF, the attachment final approval stored as the letter's PDF, and
  the attachments approved `file` questions picked. Everything else is
  `404 { "error": "file <id> not found" }`: another user's file, an
  attachment nothing picked, an archived one, a snapshot other than the
  pinned one, an id that is not a uuid, and every file of an application
  that has been reopened, sent or archived, or whose packet cannot be built.
  So a path stops working once its application leaves Ready.
- **Headers:** `Content-Disposition: attachment` with the file's name,
  `Content-Length`, `X-Content-Type-Options: nosniff` and
  `Cache-Control: no-store`. A resume is `application/pdf`; an attachment's
  type comes from the attachment route's fixed list (Attachments, below).

## Resumes

| method | path               | body                     | returns                                                                                |
| ------ | ------------------ | ------------------------ | -------------------------------------------------------------------------------------- |
| GET    | `/api/resumes`     | —                        | `ResumeSummary[]`, default first, then `created_at desc`                               |
| POST   | `/api/resumes`     | `{ name }`               | `ResumeSummary` — clones the default resume's template + every selection               |
| GET    | `/api/resumes/:id` | —                        | `{ resume, template, selections, library }` — the whole editor payload, one round trip |
| PATCH  | `/api/resumes/:id` | `{ name?, templateId? }` | `ResumeSummary`                                                                        |
| DELETE | `/api/resumes/:id` | —                        | `204` · `400` if it is the default resume                                              |

## Selections (autosave target)

| method | path                          | body                  |
| ------ | ----------------------------- | --------------------- |
| PUT    | `/api/resumes/:id/selections` | `Partial<Selections>` |

Replaces each provided slice wholesale inside one transaction: delete the resume's
rows for that slice, re-insert with `sort_order` = array index. Slices not present
in the body are untouched. Idempotent — safe to call on every debounced keystroke.

## Rendering & PDFs

| method | path                      | body                    | returns                                                                                                  |
| ------ | ------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| POST   | `/api/resumes/:id/render` | `{ templateOverride? }` | `{ ok, pdfBase64?, pages, errors: string[], warnings: string[], log }` — **preview only, saves nothing** |
| POST   | `/api/resumes/:id/pdf`    | —                       | `{ ok: true, filename, createdAt }` — renders, stores a `resume_pdf` snapshot                            |
| GET    | `/api/resumes/:id/pdf`    | —                       | `application/pdf` of the **latest snapshot** + `Content-Disposition: attachment`; `404` if never saved   |

`templateOverride` lets the Template tab preview unsaved LaTeX without persisting it.

A LaTeX compile failure is **not** an HTTP error on either POST — it is a `200`
with `ok: false`. `POST /pdf` then returns the same failure shape `/render` does
(`{ ok: false, pages, errors, warnings, log }`) and stores nothing, because there
is no PDF to name or snapshot. Clients must branch on `.ok`, never on
`response.ok` alone.

## Cover letters

| method | path                                   | body                                      | returns                                             |
| ------ | -------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| GET    | `/api/cover-letters?includeArchived=1` | —                                         | `CoverLetterSummary[]`, default first then newest   |
| POST   | `/api/cover-letters`                   | `{ name, sourceCoverLetterId? }`          | `201 CoverLetter` — copies the default, verbatim    |
| GET    | `/api/cover-letters/:id`               | —                                         | `CoverLetter`                                       |
| PATCH  | `/api/cover-letters/:id`               | `{ name?, content?, body?, isArchived? }` | `CoverLetter`                                       |
| POST   | `/api/cover-letters/:id/render`        | `{ contentOverride?, bodyOverride? }`     | `RenderResult` — **preview only, saves nothing**    |
| GET    | `/api/cover-letters/:id/pdf`           | —                                         | `application/pdf`, compiled from the **saved** text |

Thinner than the resume surface by a whole layer, because a cover letter is
its text: there are no selections to save and no snapshot to take (D-035).
`content` may be empty — a letter you have cleared out to start over is a
normal editor state. `sourceCoverLetterId` copies a letter other than the
default; a source belonging to somebody else is a `400`, the same answer as
one that does not exist.

`isDefault` is **not** patchable. Which letter is the default is set at
provisioning, and flipping it would need the old default cleared in the same
transaction or the partial unique index rejects the write.

**`body` is plain text** (D-046). Every render, the preview, the download and
final approval alike, escapes it and puts it in place of the one line of
`content` that holds only `%%BODY%%` (spaces or tabs around it allowed); a
blank line starts a paragraph and a single line break is kept. A letter whose
`body` is null compiles `content` verbatim. `body` is a string, possibly
empty, and never set back to null. A PATCH is a `400` naming the problem
when it would leave a non-null body with no marker line, or with more than
one: setting a body on a letter without one, or deleting the marker from a
letter that has a body. A letter with no body takes any `content`. On
`/render`, a draft with that problem is the same `200 { ok: false, errors }`
as a compile failure, with the problem as its one error, and `GET /pdf`
answers it with the `400` a compile failure gets. A copy, from
`POST /api/cover-letters` or `POST /api/applications/:id/cover-letter`,
carries the source's `body` along with its `content`.

**There is no DELETE**, and archiving the default is a `400`. With no PDF
snapshot behind it, a letter's text is the only record of what was sent, and
the default is what every new letter is copied from.

**`GET /pdf` is the one place in the app where a LaTeX error is an HTTP
error.** It compiles on demand and answers `400 { error }` when the stored
text does not compile (and `502` when the sidecar itself is unreachable),
because a binary download has no JSON envelope to carry `ok: false` in and a
`.pdf` that is secretly an error object is worse than a status code. Every
other render endpoint, `POST /render` included, keeps the `200 { ok: false }`
contract.

## Applications

| method | path                                  | body                                                                                             | returns                                                            |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| GET    | `/api/applications?includeArchived=1` | —                                                                                                | `ApplicationSummary[]`, `created_at desc`                          |
| POST   | `/api/applications`                   | `{ company, roleTitle?, postingUrl?, resumeId? }`                                                | `201 ApplicationDetail`                                            |
| GET    | `/api/applications/:id`               | —                                                                                                | `ApplicationDetail`                                                |
| PATCH  | `/api/applications/:id`               | `{ company?, roleTitle?, postingUrl?, notes?, status?, resumeId?, coverLetterId?, isArchived? }` | `ApplicationDetail`                                                |
| POST   | `/api/applications/:id/cover-letter`  | —                                                                                                | `201 ApplicationDetail` — copies the default letter and links it   |
| POST   | `/api/applications/:id/apply`         | —                                                                                                | `{ ok: true, application }` — renders, snapshots, pins             |
| GET    | `/api/applications/:id/pdf`           | —                                                                                                | `application/pdf` of the snapshot **that was sent**; `404` if none |
| POST   | `/api/applications/:id/approvals`     | `{ section: 'resume' \| 'coverLetter' }`                                                         | `ApplicationDetail` — approves one section of the review           |
| POST   | `/api/applications/:id/approve`       | —                                                                                                | `{ ok: true, application }` — final approval; it is now `ready`    |

`appliedAt` is deliberately not writable: it follows from `status`, stamped the
first time an application reaches `applied`, `interviewing`, `offered` or
`rejected` — never on entering `draft` or a flow status — and never cleared
(docs/SCHEMA.md).
`resumeId: null` and `coverLetterId: null` unlink those documents without
touching them; `postingUrl` must be empty or http(s), since it is rendered as
a link.

PATCH `status` accepts only the manual statuses: `draft`, `applied`,
`interviewing`, `offered`, `rejected`. `proposing`, `needs_review` and `ready`
are a `400`: only the review flow sets them, because `ready` vouches for
approvals and a snapshot that a hand-set status would skip (D-041). An
application already in one of them can still be PATCHed to any manual status.
`jobDescription`, `agentSummary` and `fitScore` are read-only here; they
arrive from the agent.

`createResumeFrom` clones that resume under the company's name and links the
copy — the normal path, since a new application arrives with something to
tailor. `resumeId` links a resume that already exists instead; passing both is
a `400`, and passing neither leaves the application without one.

**`POST /pdf` is "save this resume to the application".** It renders the
linked resume, stores a `resume_pdf` snapshot, and points the application at
it, leaving the status alone — this is what the resume editor calls when it
was opened from an application. `400` if no resume is linked, and `400` on a
Ready application, before anything is compiled: its PDF is the one final
approval pinned, and only the next final approval replaces it (D-044).

**`POST /apply` declares it sent**, which is what moves it off the pipeline
board and into the Applied table. If nothing has been saved to the application
yet it takes that snapshot first, so a sent application is never left with no
record; if one is already pinned, that snapshot stands and nothing is
re-rendered. Pinning a new snapshot is refused with a `400` on a Ready
application, as `POST /pdf` is; sending one keeps the PDF that was approved.

A LaTeX compile failure is **not** an HTTP error on either POST: it is
`200 { ok: false, pages, errors, warnings, log }` and nothing is written,
exactly as for `POST /api/resumes/:id/pdf`. Branch on `.ok`.

`GET /api/applications/:id/pdf` returns the bytes this application was sent
with — never a fresh render, and never the resume's _latest_ snapshot either.

**`POST /cover-letter` is "add a cover letter"**: it copies the caller's
default letter under this application's company name and links it. Its own
endpoint rather than a flag on create, because a letter is a later, optional
decision than the resume — plenty of postings never ask for one. There is no
counterpart to `POST /pdf` here: the letter is a private copy, so editing it
_is_ saving it to the application, and `GET /api/cover-letters/:id/pdf`
serves it (D-035). The one exception is final approval, below, which stores
the approved letter's PDF as an attachment (D-044).

**There is no DELETE.** `{ "isArchived": true }` takes an application off the
board. Deleting a resume that an application was sent with is refused with a
`400`, because `resume_pdf` cascades from `resume` and that snapshot is the
only record of what went out.

### The review flow

An application the agent has submitted (`needs_review`) is reviewed section
by section on `/applications/:id/review`, then finally approved, which makes
it `ready` (C3, D-044).

**`POST /approvals`** stamps `resumeApprovedAt` or `coverLetterApprovedAt`.
Only in `needs_review`, and only for a section the application has; anything
else is a `400` saying why ("Only an application in Needs review can be
approved; this one is Ready.", "This application has no cover letter to
approve.").

**`POST /approve`** is refused with a `400` listing what is left ("Approve the
resume first. Approve the cover letter first.") unless the application is in
`needs_review`, has a resume, and every section it shows is approved: the
resume, the cover letter when one is linked, and every **required** question
("Approve the 2 required questions still open in step 3."). An optional
question left unapproved is left blank. It then compiles both
documents, writing nothing yet, and in one transaction stores a `resume_pdf`
snapshot named after the company and pins it as `sentPdf` (the path `POST
/pdf` takes), stores the letter's PDF as an `application/pdf` attachment named
like its download (`<prefix>_<Company>_Cover_Letter.pdf`), archiving any
earlier one of that name, and sets `approvedAt` and `ready`. A LaTeX failure,
or an unreachable sidecar, is `200 { ok: false, pages, errors, warnings, log }`
with each error prefixed `Resume:` or `Cover letter:`, and nothing is written.
If an edit lands while the documents compile, the transaction finds the
section or the question unapproved again, rolls back, and answers `400`
("This application changed while it was being approved; review it again."). Final approval does
not enforce one page; `submit_for_review` does.

**What reopens an approval.** These writes clear the approval of the section
they change, and `approvedAt` with it, on every one of the caller's
applications in `needs_review` or `ready` that sends that document; a `ready`
one goes back to `needs_review`:

- the resume: `PUT /api/resumes/:id/selections` (so editor autosave), and the
  agent's `set_resume_selection`;
- the letter: `PATCH /api/cover-letters/:id` with `content` or `body`, and
  the agent's `set_cover_letter_body`;
- `PATCH /api/applications/:id` changing `resumeId` or `coverLetterId`,
  unlinking included (a `status` in the same PATCH wins), and `POST
/cover-letter`, which adds a section to approve;
- a question: `PATCH /api/application-questions/:id`, archiving the attachment
  an approved file answer names, and the agent's `add_questions` when it adds
  or redrafts one. These clear the question's own `approvedAt` and the
  application's `approvedAt`; there is no application stamp for questions.

Nothing else does: library edits (bullets, experiences, projects, skills),
template edits, renaming a letter, remembering an answer and editing a saved
answer leave every approval in place, because a global edit made elsewhere
must not reopen anything (C6). The pinned snapshot
is what gets sent. There is no diffing: a selection write that puts back what
was there still reopens. Applications that have been sent (`applied` and
later) are never reopened, and a reopened one keeps its pinned `sentPdf` until
a new one is pinned.

### Questions

| method | path                                      | body                                     | returns                 |
| ------ | ----------------------------------------- | ---------------------------------------- | ----------------------- |
| PATCH  | `/api/application-questions/:id`          | `{ answer?, answerMode?, redraftNote? }` | `ApplicationQuestion`   |
| PUT    | `/api/application-questions/:id/remember` | `{ remember }`                           | `ApplicationQuestion`   |
| POST   | `/api/applications/:id/questions/approve` | `{ questionIds }`                        | `ApplicationQuestion[]` |

An application's form questions arrive from the agent (`add_questions`) and
are answered and approved in the review's Questions step (D-047).

**`PATCH /api/application-questions/:id`** edits one: `answer` (a string, a
`string[]` of options for a multi question, or `null` to clear it),
`answerMode`, and `redraftNote`. Every accepted write unapproves the question
and, on an application in `needs_review` or `ready`, clears its `approvedAt`,
so a `ready` one goes back to `needs_review`. There is no diffing. A `400`
says why when:

- the application has been sent (`applied` or later);
- the answer does not fit the kind: a choice takes one of its `options`
  exactly, a multi a list of distinct options, a bool `yes` or `no`, and a
  file the id of a non-archived attachment of the same application (anything
  else, another user's included, is `unknown attachment id`);
- `answerMode: 'instruction'` is set on anything but a choice or multi
  question. Switching the mode without sending an answer clears the answer;
- `redraftNote` is set on anything but a non-EEO `text` or `letter` question.
  The note is what the agent reads through `get_application`; `null` or a
  blank note cancels the request.

While the question has a live `savedAnswerId`, a new answer is written
through to that saved answer too, with its mode: a global edit, like a
bullet's. Clearing the answer writes nothing through, and the saved answer's
prompt never changes.

**`PUT /api/application-questions/:id/remember`** is the "remember this
answer" checkbox (D-048). `remember: true` saves the question's answer as a
`SavedAnswer` and sets `savedAnswerId`, or, when it already has a live one,
updates that one with the current answer. It is a `400` on a `file` question
("File answers can't be remembered."), on one with no answer ("Answer it
first."), and on an answer that no longer fits its kind. `remember: false`
archives the linked saved answer, never deleting it, and sets `savedAnswerId`
to `null`; the next tick saves a new one. Either way the answer, its source
and its approval are untouched, and **nothing is reopened**: remembering an
answer is not an edit to it, which is why this is not the PATCH. Repeating
either is harmless. Refused once the application has been sent. Another
user's question is a `404`.

**`POST /api/applications/:id/questions/approve`** stamps `approvedAt` on
exactly `questionIds`, and clears any redraft request on them. All or none:
only in `needs_review`; an id that is not one of this application's questions
is `unknown question id`; and each must have an answer that fits its kind, a
file answer naming a live attachment. A refusal lists every problem at once,
each prefixed with its prompt ("Work authorization: answer it first."). The
ids are the ones the page showed, so a question the agent adds after the page
loaded is never approved unseen.

### Attachments

| method | path                          | body                  | returns               |
| ------ | ----------------------------- | --------------------- | --------------------- |
| POST   | `/api/applications/:id/files` | `multipart/form-data` | `201 ApplicationFile` |
| GET    | `/api/application-files/:id`  | —                     | the file's bytes      |
| PATCH  | `/api/application-files/:id`  | `{ isArchived }`      | `ApplicationFile`     |

One form field, `file`, ≤ 4 MB, any type — multipart rather than JSON for the
same reason `/api/feedback` uses it. A cover letter authored in this app is
not an attachment; it is a `cover_letter` row with its own endpoints above. Responses are always
`Content-Disposition: attachment` with `X-Content-Type-Options: nosniff`, and
the content type comes from a fixed list rather than the upload, so an
uploaded HTML file cannot be served back as a live page on this origin.

## Library (the caller’s content)

| method | path                             | body                                                       |
| ------ | -------------------------------- | ---------------------------------------------------------- |
| GET    | `/api/library?includeArchived=1` | — → `{ experiences, projects, skillRows, templates }`      |
| POST   | `/api/experiences`               | `{ company, title, dateRange, location }`                  |
| PATCH  | `/api/experiences/:id`           | `{ company?, title?, dateRange?, location?, isArchived? }` |
| POST   | `/api/experiences/:id/bullets`   | `{ content }`                                              |
| PATCH  | `/api/experience-bullets/:id`    | `{ content?, isArchived? }`                                |
| POST   | `/api/projects`                  | `{ name, technologies, dateRange }`                        |
| PATCH  | `/api/projects/:id`              | `{ name?, technologies?, dateRange?, isArchived? }`        |
| POST   | `/api/projects/:id/bullets`      | `{ content }`                                              |
| PATCH  | `/api/project-bullets/:id`       | `{ content?, isArchived? }`                                |
| POST   | `/api/skill-rows`                | `{ name, top, separator? }`                                |
| PATCH  | `/api/skill-rows/:id`            | `{ name?, top?, separator?, isArchived? }`                 |
| POST   | `/api/skill-rows/:id/skills`     | `{ name }`                                                 |
| PATCH  | `/api/skills/:id`                | `{ name?, isArchived? }`                                   |
| PATCH  | `/api/templates/:id`             | `{ name?, content?, isArchived? }`                         |

**There is no DELETE for content.** Archiving is the only removal. Creating content
does _not_ auto-select it into any resume; the editor issues a follow-up
`PUT /selections` if the user wants it on the current resume.

## Feedback

The only endpoint that writes somewhere other than the database.

| method | path            | body                  | returns                                   |
| ------ | --------------- | --------------------- | ----------------------------------------- |
| POST   | `/api/feedback` | `multipart/form-data` | `201 { number, url, screenshotUploaded }` |

Form fields: `kind` (`bug` \| `feature`, required), `description` (required,
≤ 10 000 chars), `url` (required, the page being reported on — http(s) only),
`viewport`, `userAgent`, `planFirst` (`true` \| `false`, default `false`), and an
optional `screenshot` file (`image/png` \| `jpeg` \| `gif` \| `webp`, ≤ 4 MB).

Multipart rather than JSON because a base64 screenshot inside JSON would be
~33% larger against Vercel's 4.5 MB request-body limit. The widget downscales
anything over 1 MB before sending.

Creates a GitHub issue in `GITHUB_REPO`, labelled `feedback` + `bug`/`enhancement`,
plus `plan-first` when `planFirst` is `true` — which makes `/implement` stop at a
plan on the Excalidraw board instead of building straight through (D-036).
The submitted `url` is split in the body: the route leads it, while the origin,
the browser parsed out of `userAgent`, and the raw `userAgent` sit in the
collapsed Environment block (D-024).
A screenshot is committed to the orphan `FEEDBACK_ASSETS_BRANCH` branch and linked
in the body at that commit's sha, so the image is immutable. If the screenshot
upload fails the issue is still filed, says so in its body, and the response
carries `screenshotUploaded: false` — the written report is never lost over an
image.

Statuses beyond the usual: **503** if `GITHUB_TOKEN`/`GITHUB_REPO` are unset
(fails closed — feedback is never silently dropped), **502** if GitHub itself
refuses.

## Latex service

Not part of the Next.js app. `POST http://latex:8080/compile`
→ `{ tex: string }` → `{ ok, pdfBase64, pages, errors, log, durationMs }`.
Also `GET /health` → `{ ok: true }`.
