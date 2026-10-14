# Database schema (contract)

Postgres. All ids are `uuid primary key default gen_random_uuid()`.
All tables get `created_at timestamptz not null default now()` and
`updated_at timestamptz not null default now()` (maintained by a shared trigger).

`is_archived boolean not null default false` — **we never delete content.** Archived
rows stay referenced by existing resumes and keep rendering there; they are just
hidden from the picker unless "show archived" is toggled on.

## Ownership — every row belongs to exactly one user

The eight **root** tables carry `user_id uuid not null references users (id) on
delete restrict`:

`template`, `experience`, `project`, `technical_skill_row`, `resume`,
`cover_letter`, `application`, `api_token`.

Everything else infers its owner through its parent and carries **no**
`user_id` of its own:

| table                         | owner is                | reached via              |
| ----------------------------- | ----------------------- | ------------------------ |
| `experience_bullet`           | its experience's owner  | `experience_id`          |
| `project_bullet`              | its project's owner     | `project_id`             |
| `technical_skill`             | its row's owner         | `technical_skill_row_id` |
| every `resume_*` bridge table | its resume's owner      | `resume_id`              |
| `resume_pdf`                  | its resume's owner      | `resume_id`              |
| `application_file`            | its application's owner | `application_id`         |
| `bullet_suggestion`           | its application's owner | `application_id`         |

This is deliberate. A second `user_id` on a bullet would be a second,
independently-writable copy of a fact the parent already records, and the two
could disagree — a bullet claiming one owner while its experience claims
another. One source of truth per fact.

The cost is that the query layer, not the schema, enforces isolation on the
inferred tables: a bullet update filters through a join to its parent, and
every content id arriving in a selections request is re-checked against the
caller's `user_id` before any bridge row is written. `lib/queries/isolation.test.ts`
is the executable statement of that guarantee.

`on delete restrict`, not `cascade`: content is never deleted (D-011), so
removing a user is a deliberate manual operation. A cascade could not work
anyway — `experience_bullet` restricts deletion of its experience, so the
cascade would stop there.

### `users`

| column             | type          | notes                                                                                          |
| ------------------ | ------------- | ---------------------------------------------------------------------------------------------- |
| `email`            | text not null | unique on `lower(email)` — identity is case-insensitive                                        |
| `name`             | text          | nullable; display only                                                                         |
| `supabase_user_id` | text          | join key to Supabase's `auth.users.id`; unique **when not null**, null until OAuth is wired up |

Named `users`, not `user`, because `user` is a reserved word in Postgres.
**There is no password column and there never will be one** — authentication
is external (see `docs/API.md`, "Auth modes").

### `api_token`

The credential an agent presents to `/api/mcp/**` (D-039). A root table, so
one token belongs to exactly one user.

| column         | type                        | notes                                                    |
| -------------- | --------------------------- | -------------------------------------------------------- |
| `user_id`      | uuid → `users(id)` not null | whose account the token acts as                          |
| `label`        | text not null               | which agent or machine holds it                          |
| `token_hash`   | text not null               | hex sha-256 of the `rmx_…` secret; unique                |
| `last_used_at` | timestamptz                 | stamped on every successful call; null until the first   |
| `revoked_at`   | timestamptz                 | null while the token works; set once and **never** reset |

**Only the hash is stored.** The secret is shown once, by
`npm run token:create`, and nothing can recover it afterwards. Unsalted
sha-256 is enough because the secret is 32 random bytes rather than something
a person chose, and a deterministic hash is what lets `ux_api_token_token_hash`
be the lookup.

**Tokens are revoked, never deleted.** `revoked_at` ends a token; the row
stays, so `label`, `last_used_at` and `revoked_at` remain a record of what had
access and when. Revoking twice keeps the first date.

## Content tables (per-user)

### `template`

| column        | type                           | notes                                          |
| ------------- | ------------------------------ | ---------------------------------------------- |
| `name`        | text not null                  |                                                |
| `content`     | text not null                  | raw LaTeX with tokens (see TEMPLATE_TOKENS.md) |
| `is_default`  | boolean not null default false | partial unique index: only one true            |
| `is_archived` | boolean not null default false |                                                |

### `experience`

`company` text, `title` text, `date_range` text, `location` text, `is_archived`,
`user_id` → `users(id)`.

### `experience_bullet`

`experience_id` → `experience(id)`, `content` text, `is_archived`.

### `project`

`name` text, `technologies` text, `date_range` text, `is_archived`,
`user_id` → `users(id)`.

### `project_bullet`

`project_id` → `project(id)`, `content` text, `is_archived`.

### `technical_skill_row`

`name` text, `top` boolean not null default true, `is_archived`,
`separator` text not null default `', '`, `user_id` → `users(id)`.
`top = true` → renders in the top "Technical Skills" section;
`top = false` → renders in the bottom "Additional Information" section.
`separator` is the string used to join this row's skills — `', '` for skill lists,
`' $|$ '` for the interests/accolades rows (see D-013).

### `technical_skill`

`technical_skill_row_id` → `technical_skill_row(id)`, `name` text, `is_archived`.

> **Deliberate addition to the spec.** The spec listed `technical_skill` with only
> `name`/`is_archived`, but the bridge table `resume_technical_skill` carries no row
> reference — so a skill must know its row, exactly as `experience_bullet` knows its
> experience. Without it "JavaScript" could not be placed under "Languages".

## Resume

### `resume`

`name` text not null, `is_default` boolean not null default false
(partial unique index: only one true **per user**), `template_id` →
`template(id)` not null, `user_id` → `users(id)` not null.

A resume may only reference its own owner's template; `updateResume` rejects a
`templateId` belonging to anyone else with a 400, the same answer it gives for
a template id that does not exist.

## Bridge tables — selection _and_ ordering

**Presence of a row means "selected".** Absence means deselected. Every bridge
table has a **composite primary key of its two foreign keys**, per spec, plus
`sort_order integer not null`.

(`order` is a SQL keyword, so the column is named `sort_order`.)

| table                        | columns                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `resume_experience`          | `resume_id`, `experience_id`, `sort_order` — pk(resume_id, experience_id)                   |
| `resume_experience_bullet`   | `resume_id`, `experience_bullet_id`, `sort_order` — pk(resume_id, experience_bullet_id)     |
| `resume_project`             | `resume_id`, `project_id`, `sort_order` — pk(resume_id, project_id)                         |
| `resume_project_bullet`      | `resume_id`, `project_bullet_id`, `sort_order` — pk(resume_id, project_bullet_id)           |
| `resume_technical_skill_row` | `resume_id`, `technical_skill_row_id`, `sort_order` — pk(resume_id, technical_skill_row_id) |
| `resume_technical_skill`     | `resume_id`, `technical_skill_id`, `sort_order` — pk(resume_id, technical_skill_id)         |

All bridge FKs are `on delete cascade` so deleting a resume cleans up. Content is
never deleted, so content-side cascade never fires in practice.

`sort_order` is scoped to its parent: bullet ordering is per (resume, parent item),
skill ordering is per (resume, row). It is a dense 0-based sequence the API rewrites
wholesale on reorder — never patched incrementally.

## PDF snapshots

### `resume_pdf`

| column       | type                                  | notes                                            |
| ------------ | ------------------------------------- | ------------------------------------------------ |
| `resume_id`  | uuid → `resume(id)` on delete cascade |                                                  |
| `filename`   | text not null                         | `Chris_Pyle_<Company>_Resume.pdf`                |
| `bytes`      | bytea not null                        | the PDF itself                                   |
| `byte_size`  | integer not null                      |                                                  |
| `tex`        | text not null                         | exact source compiled, for drift debugging       |
| `created_at` | timestamptz                           | latest row per resume = what home page downloads |

History is kept (one row per save). "Most recent PDF" = `order by created_at desc limit 1`.

## Cover letters

### `cover_letter`

| column        | type                           | notes                                                                                    |
| ------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `user_id`     | uuid → `users(id)` not null    | a root table, like `resume`                                                              |
| `name`        | text not null                  | the company, normally — it names the download                                            |
| `content`     | text not null                  | the **whole** LaTeX document, raw and unescaped, or the shell around its `%%BODY%%` line |
| `body`        | text                           | the letter's prose, **plain text**; null for a letter written entirely in LaTeX (D-046)  |
| `is_default`  | boolean not null default false | partial unique index: one true per user                                                  |
| `is_archived` | boolean not null default false |                                                                                          |

**A cover letter stores its text; a resume deliberately does not.** That is
the one asymmetry worth understanding here. A resume is a selection of
globally-shared content because the same bullet belongs on twenty resumes and
has to be editable in one place. A cover letter is prose written for one
company and reused nowhere, so there is nothing to share: no template, no
bridge tables, no tokens (D-035).

Creating one copies `content` and `body` from the user's `is_default` row
**verbatim** — nothing about the company is substituted in.

**`body` is plain text, escaped on its way into the `.tex`** (D-046). The
agent drafts it and the review page edits it, and it is stored as typed.
When the letter renders, it is escaped (`lib/render/escape.ts`) and laid out
(a blank line starts a paragraph, a single line break is kept), then put in
place of the one line of `content` that holds only `%%BODY%%`: spaces or tabs
around it allowed, `% %%BODY%%` or `%%BODY%% x` not a marker. When `body` is
null, `content` compiles verbatim; the marker is a TeX comment and prints
nothing.

A non-null `body` always has exactly one marker line to go to. The query
layer refuses, with a `400`, any write that would leave it with none or more
than one, whether it sets the body or edits the `content` around it. A
letter with no body may hold any `content`, marker or not.

**There is no `cover_letter_pdf`.** `resume_pdf` exists because a resume's
bytes can change without anyone touching that resume; a cover letter can only
change if you edit that letter, so downloads compile it on demand. The
one PDF of a letter that is kept is the one final approval stores on its
application as an `application_file` (see `application`, below), and that is
an attachment, not a snapshot table (D-044). Otherwise this text is the only
record of what was sent, which is why removal is `is_archived` and there is
no DELETE — and why the default row cannot be archived at all, since new
letters are copied from it.

## Applications

Two tables for tracking, and deliberately only two: no company table, no
event log, no tasks, no contacts. An application is one row of mostly-optional
text plus a status, because applications differ from each other enough that
structure gets in the way (D-032). `bullet_suggestion`, last, is not tracking:
it holds the agent's proposals while an application is in review (D-045).

### `application`

| column                     | type                                                 | notes                                                                                                         |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `user_id`                  | uuid → `users(id)` not null                          | a root table, like `resume`                                                                                   |
| `company`                  | text not null                                        | plain text; two applications to one company are two rows                                                      |
| `role_title`               | text not null default `''`                           |                                                                                                               |
| `posting_url`              | text not null default `''`                           | empty or http(s) — it is rendered as a link                                                                   |
| `notes`                    | text not null default `''`                           | freeform; the only place unstructured detail goes                                                             |
| `status`                   | `application_status` not null                        | `draft` \| `proposing` \| `needs_review` \| `ready` \| `applied` \| `interviewing` \| `offered` \| `rejected` |
| `applied_at`               | timestamptz                                          | null until it first reaches `applied` or a later stage                                                        |
| `resume_id`                | uuid → `resume(id)` on delete set null               | the **live** resume being tailored                                                                            |
| `resume_pdf_id`            | uuid → `resume_pdf(id)` on delete restrict           | the **frozen** snapshot that was sent                                                                         |
| `cover_letter_id`          | uuid → `cover_letter(id)` on delete set null         | this application's own letter                                                                                 |
| `job_description`          | text                                                 | the posting's text, from the agent; null when it supplied none                                                |
| `agent_summary`            | text                                                 | the agent's evaluation, plain text; null when it supplied none                                                |
| `fit_score`                | numeric(2,1), CHECK 0–5 (`ck_application_fit_score`) | the agent's 0.0–5.0 estimate of fit (C13); null when unscored                                                 |
| `proposed_selection`       | jsonb                                                | the agent's pick (C7), as API `Selections`; each `set_resume_selection` while `proposing` overwrites it       |
| `resume_approved_at`       | timestamptz                                          | null until the resume is approved in review (C11); cleared when it changes                                    |
| `cover_letter_approved_at` | timestamptz                                          | null until the cover letter is approved in review (C11); cleared when it changes                              |
| `approved_at`              | timestamptz                                          | null until the final approval that makes it `ready` (C11); cleared when either section reopens                |
| `is_archived`              | boolean not null default false                       |                                                                                                               |

**The two resume references are not redundant.** `resume_id` is the mutable
thing you keep editing; `resume_pdf_id` is what the company actually received.
Marking an application applied sets the second and leaves the first alone, so
"what did they get?" and "what has that resume become since?" stay separately
answerable.

They also differ on delete for that reason. Losing the editor link costs
nothing, so `resume_id` is `set null`. Losing the evidence does, so
`resume_pdf_id` is `restrict` — and since `resume_pdf` cascades from `resume`,
that makes deleting a resume an application was sent with impossible.
`deleteResume` checks first and answers `400`, rather than letting Postgres
raise a foreign-key error as a 500.

**The cover letter needs only one column where the resume needed two.** The
second resume column exists because the live resume keeps changing after it
is sent and the snapshot is the only evidence of what went out. A cover
letter is a private copy that nothing else can edit, so the link _is_ the
record (D-035). `set null` for the same reason `resume_id` is: an application
that has lost its letter is still a true row about a job.

**The statuses split in two (D-041).** `proposing`, `needs_review` and
`ready` belong to the agent's review flow and are written only by it — the
API refuses them in a PATCH, because `ready` vouches for approvals and a
snapshot that a hand-set status would skip. The other five are the ones a
person sets, in any order. The enum's own order is the order an application
moves through: draft, proposing, needs_review, ready, applied, interviewing,
offered, rejected.

`applied_at` is not settable by the API. It follows from `status`
(`lib/applications/status.ts`): stamped the first time an application enters
`applied` — or `interviewing`, `offered` or `rejected` without passing
through `applied` — and never on entering `draft` or a flow status, since an
application the agent is still proposing has not been sent anywhere. It is
never cleared afterwards, including when the status moves back, because the
date something was sent is a fact and the status is an opinion.

The agent's columns are all nullable. Null means the agent never supplied
that value, which a row logged by hand never has; it is a different fact
from an empty string.

**The approval columns are the review flow's state (C11, D-044).**
`resume_approved_at` and `cover_letter_approved_at` are stamped when Chris
approves that section in `needs_review`. `approved_at` is stamped by the final
approval that moves the application to `ready`, in the same transaction that
stores a fresh `resume_pdf` snapshot and points `resume_pdf_id` at it. So
`ready` and a set `approved_at` are one fact.

Changing a section afterwards clears its stamp and `approved_at` with it, and
a `ready` row goes back to `needs_review`. Only writes that change what this
application sends do that: its resume's selection, its letter's `content` or
`body`, and relinking or unlinking `resume_id` or `cover_letter_id`. Library and
template edits do not (C6). Rows that have been sent keep their stamps as
history. A reopened row keeps its `resume_pdf_id` until a new one is pinned.
While `ready`, nothing but final approval writes `resume_pdf_id`: saving the
resume to the application, or sending it with a new snapshot, is refused.

**The approved letter's PDF is an `application_file`.** Final approval
compiles the letter and stores it as an attachment named like the letter's
download (`<prefix>_<Company>_Cover_Letter.pdf`, `application/pdf`). The
approved letter is the application's one non-archived file with that name:
approving again archives the earlier one rather than deleting it (D-011).
There is no pointer column to it, because the board's data model has none
(D-032).

### `application_file`

| column           | type                                       | notes                                    |
| ---------------- | ------------------------------------------ | ---------------------------------------- |
| `application_id` | uuid → `application(id)` on delete cascade | owner inherited through this             |
| `filename`       | text not null                              | sanitized: no path components            |
| `content_type`   | text not null                              | as uploaded; **not** what is served back |
| `bytes`          | bytea not null                             |                                          |
| `byte_size`      | integer not null                           |                                          |
| `is_archived`    | boolean not null default false             |                                          |

No `kind` column: a take-home, a screenshot of the posting and an offer
letter are all just files. (A cover letter authored here is not one of them —
it is a `cover_letter` row. Uploading someone else's PDF as an attachment is
still perfectly normal.) Uploads are capped at 4 MB
(`lib/applications/attachments.ts`), and what comes back out is typed from a
fixed list rather than echoed from the upload, so a stored `.html` cannot come
back as a live page on this origin.

### `bullet_suggestion`

What the agent would change about the bullets on one application's resume,
held until Chris applies or rejects it in review (D-045). The agent never
writes to the library; this table is how it proposes to.

| column           | type                                       | notes                                                                       |
| ---------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `application_id` | uuid → `application(id)` on delete cascade | owner inherited through this                                                |
| `kind`           | `bullet_suggestion_kind` not null          | `edit` \| `add`                                                             |
| `bullet_kind`    | `bullet_kind` not null                     | `experience` \| `project`: which tables the two ids below point into        |
| `bullet_id`      | uuid, no FK                                | an edit's bullet: an `experience_bullet` or a `project_bullet`              |
| `parent_id`      | uuid, no FK                                | an addition's parent: an `experience` or a `project`                        |
| `position`       | integer                                    | an addition's slot among the parent's bullets this resume shows; 0 is first |
| `proposed_text`  | text not null                              | plain text, one line; escaped into LaTeX only when it renders               |
| `rationale`      | text not null                              | why the agent suggests it                                                   |
| `status`         | `bullet_suggestion_status` not null        | `pending` \| `applied` \| `copied` \| `rejected`, default `pending`         |

Two CHECKs. `ck_bullet_suggestion_target`: an edit has a `bullet_id` and
neither of the other two, an addition a `parent_id` and a `position` of 0 or
more and no `bullet_id`. `ck_bullet_suggestion_text`: neither text is blank.
The partial unique index `ux_bullet_suggestion_pending_edit` on
`(application_id, bullet_id) where status = 'pending'` allows one pending edit
per bullet per application; a second edit replaces the first, and additions,
whose `bullet_id` is null, never collide.

**`bullet_id` and `parent_id` have no foreign keys**, because each points into
one of two tables, chosen by `bullet_kind`. Content is never deleted (D-011),
so a target cannot vanish, and every use goes back through the user-scoped
bullet queries, which re-check that the caller owns it.

**A row is never deleted.** Resolving one sets `status` and keeps the row:
`applied` for Apply to bullet (the library bullet's content becomes the
escaped text) and for Add bullet (a new bullet, selected at `position`),
`copied` for Save as new (a sibling bullet swapped into this resume's
selection), `rejected` for Reject. Only a pending row's text can be edited,
and only in `needs_review`; Chris's edit overwrites `proposed_text`.
