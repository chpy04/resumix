# Database schema (contract)

Postgres. All ids are `uuid primary key default gen_random_uuid()`.
All tables get `created_at timestamptz not null default now()` and
`updated_at timestamptz not null default now()` (maintained by a shared trigger).

`is_archived boolean not null default false` — **we never delete content.** Archived
rows stay referenced by existing resumes and keep rendering there; they are just
hidden from the picker unless "show archived" is toggled on.

## Ownership — every row belongs to exactly one user

The six **root** tables carry `user_id uuid not null references users (id) on
delete restrict`:

`template`, `experience`, `project`, `technical_skill_row`, `resume`,
`application`.

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

## Applications

Two tables, and deliberately only two: no company table, no event log, no
tasks, no contacts. An application is one row of mostly-optional text plus a
status, because applications differ from each other enough that structure gets
in the way (D-032).

### `application`

| column          | type                                       | notes                                                             |
| --------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `user_id`       | uuid → `users(id)` not null                | a root table, like `resume`                                       |
| `company`       | text not null                              | plain text; two applications to one company are two rows          |
| `role_title`    | text not null default `''`                 |                                                                   |
| `posting_url`   | text not null default `''`                 | empty or http(s) — it is rendered as a link                       |
| `notes`         | text not null default `''`                 | freeform; the only place unstructured detail goes                 |
| `status`        | `application_status` not null              | `draft` \| `applied` \| `interviewing` \| `offered` \| `rejected` |
| `applied_at`    | timestamptz                                | null exactly while nothing has been sent                          |
| `resume_id`     | uuid → `resume(id)` on delete set null     | the **live** resume being tailored                                |
| `resume_pdf_id` | uuid → `resume_pdf(id)` on delete restrict | the **frozen** snapshot that was sent                             |
| `is_archived`   | boolean not null default false             |                                                                   |

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

`applied_at` is not settable by the API. It follows from `status`
(`lib/applications/status.ts`): stamped the first time an application leaves
`draft`, never cleared afterwards — including when the status moves back,
because the date something was sent is a fact and the status is an opinion.

### `application_file`

| column           | type                                       | notes                                    |
| ---------------- | ------------------------------------------ | ---------------------------------------- |
| `application_id` | uuid → `application(id)` on delete cascade | owner inherited through this             |
| `filename`       | text not null                              | sanitized: no path components            |
| `content_type`   | text not null                              | as uploaded; **not** what is served back |
| `bytes`          | bytea not null                             |                                          |
| `byte_size`      | integer not null                           |                                          |
| `is_archived`    | boolean not null default false             |                                          |

No `kind` column: a cover letter, a take-home, a screenshot of the posting and
an offer letter are all just files. Uploads are capped at 4 MB
(`lib/applications/attachments.ts`), and what comes back out is typed from a
fixed list rather than echoed from the upload, so a stored `.html` cannot come
back as a live page on this origin.
