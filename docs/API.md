# API contract

All routes live under `app/api/**/route.ts`. All are server-side and require a
valid auth token except `POST /api/auth`.

**Auth header:** `x-resumix-token: <token>`. Middleware rejects with `401` otherwise.
The browser keeps the token in `localStorage` under `resumix.token`.

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

| method | path        | body           | returns                       |
| ------ | ----------- | -------------- | ----------------------------- |
| POST   | `/api/auth` | `{ password }` | `{ token }` · 401 on mismatch |

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
| POST   | `/api/resumes/:id/pdf`    | —                       | `{ filename, createdAt }` — renders, stores a `resume_pdf` snapshot                                      |
| GET    | `/api/resumes/:id/pdf`    | —                       | `application/pdf` of the **latest snapshot** + `Content-Disposition: attachment`; `404` if never saved   |

`templateOverride` lets the Template tab preview unsaved LaTeX without persisting it.

## Library (global content)

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

## Latex service

Not part of the Next.js app. `POST http://latex:8080/compile`
→ `{ tex: string }` → `{ ok, pdfBase64, pages, errors, log, durationMs }`.
Also `GET /health` → `{ ok: true }`.
