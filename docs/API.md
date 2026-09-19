# API contract

All routes live under `app/api/**/route.ts`. All are server-side and require a
session except `POST /api/auth`.

**Everything is scoped to the caller.** Every handler resolves a user via
`requireUserId(request)` and passes that id to the query layer; there is no
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
```

## Auth

| method | path           | body           | returns                                                     |
| ------ | -------------- | -------------- | ----------------------------------------------------------- |
| POST   | `/api/auth`    | `{ password }` | `{ token }` · 401 on mismatch · 400 outside `password` mode |
| GET    | `/api/session` | —              | `SessionInfo` = `{ user, mode }` · **401 = show the login** |

The browser calls `GET /api/session` on load rather than treating a stored
token as proof of a session: in `dev` mode there is no token at all, and the
answer is whichever user the seed created.

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
`viewport`, `userAgent`, and an optional `screenshot` file
(`image/png` \| `jpeg` \| `gif` \| `webp`, ≤ 4 MB).

Multipart rather than JSON because a base64 screenshot inside JSON would be
~33% larger against Vercel's 4.5 MB request-body limit. The widget downscales
anything over 1 MB before sending.

Creates a GitHub issue in `GITHUB_REPO`, labelled `feedback` + `bug`/`enhancement`.
The submitted `url` is split in the body: the route leads it, while the origin,
the browser parsed out of `userAgent`, and the raw `userAgent` sit in the
collapsed Environment block (D-023).
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
