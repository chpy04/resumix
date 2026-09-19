/**
 * Typed client for the routes documented in `docs/API.md`. This is the only
 * module that knows URL shapes — every component calls through here so the
 * URLs, request bodies, and response parsing live in exactly one place.
 *
 * Every request goes through `authedFetch` (never bare `fetch`), per project
 * convention: it attaches the stored token and handles 401 -> logout.
 */

import { authedFetch } from './auth-client.ts';
import type { FeedbackKind } from './feedback/issue.ts';
import type {
  Bullet,
  Experience,
  Project,
  RenderResult,
  ResumeDetail,
  ResumeSummary,
  Selections,
  Skill,
  SkillRow,
  Template,
} from './types.ts';

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/** `POST /api/resumes/:id/pdf` — see docs/agents/t6.md Deviations #2. */
export type SaveResumePdfResult =
  | { ok: true; filename: string; createdAt: string }
  | { ok: false; pages: number | null; errors: string[]; warnings: string[]; log: string };

/** Thrown for any non-2xx response. Carries the server's `{ error }` message when present. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body && typeof body.error === 'string' && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // Body wasn't JSON (or was empty) — fall through to a generic message.
  }
  return `Request failed with status ${response.status}`;
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await authedFetch(input, init);
  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }
  // 204 No Content has no body to parse.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * `POST /api/auth` — the one request made before a token exists, so it is
 * also the one that cannot use `authedFetch`'s 401 handling: a wrong
 * password is the expected outcome, not an expired session. Returns the
 * minted token, or `null` when the password was rejected.
 */
export async function login(password: string): Promise<string | null> {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ password }),
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }
  const body = (await response.json()) as { token: string };
  return body.token;
}

/** `GET /api/resumes` — default first, then most-recently-created first. */
export function listResumes(): Promise<ResumeSummary[]> {
  return requestJson<ResumeSummary[]>('/api/resumes');
}

/** `POST /api/resumes` — clones the default resume's template + selections. */
export function createResume(name: string): Promise<ResumeSummary> {
  return requestJson<ResumeSummary>('/api/resumes', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
}

/** `DELETE /api/resumes/:id` — 400s server-side if this is the default resume. */
export function deleteResume(id: string): Promise<void> {
  return requestJson<void>(`/api/resumes/${id}`, { method: 'DELETE' });
}

/** `GET /api/resumes/:id` — the whole editor payload in one round trip (D-012). */
export function getResumeDetail(id: string): Promise<ResumeDetail> {
  return requestJson<ResumeDetail>(`/api/resumes/${id}`);
}

/** `PATCH /api/resumes/:id` — renaming a resume or swapping its template. */
export function updateResume(
  id: string,
  patch: { name?: string; templateId?: string },
): Promise<ResumeSummary> {
  return requestJson<ResumeSummary>(`/api/resumes/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

/**
 * `PUT /api/resumes/:id/selections` — the autosave target for ordering and
 * on/off selection. Only send the slice(s) that changed; each slice is
 * replaced wholesale, so a nested slice's value must be its *entire*
 * current map, not just the parent that changed (see
 * `lib/editor/selections-reducer.ts`).
 */
export function updateSelections(id: string, patch: Partial<Selections>): Promise<Selections> {
  return requestJson<Selections>(`/api/resumes/${id}/selections`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

/**
 * `POST /api/resumes/:id/pdf` — renders, compiles, and stores a snapshot.
 * Check `.ok` before reading `.filename`; a LaTeX failure is `200 { ok: false, ... }`,
 * never a thrown `ApiError` (see docs/agents/t6.md Deviations #2).
 */
export function saveResumePdf(id: string): Promise<SaveResumePdfResult> {
  return requestJson<SaveResumePdfResult>(`/api/resumes/${id}/pdf`, { method: 'POST' });
}

/**
 * `POST /api/resumes/:id/render` — the live preview pane's only network
 * call. **Never persists anything** (that's `/pdf`, above). `templateOverride`
 * lets the Template tab preview unsaved LaTeX. Check `.ok`: a LaTeX compile
 * failure is a normal `200 { ok: false, errors, warnings }`, never a thrown
 * `ApiError` — same shape as `saveResumePdf` (docs/agents/t6.md Deviations #2).
 */
export function renderResume(id: string, templateOverride?: string): Promise<RenderResult> {
  return requestJson<RenderResult>(`/api/resumes/${id}/render`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(templateOverride === undefined ? {} : { templateOverride }),
  });
}

// ---------------------------------------------------------------------------
// Library (global content) — creating/updating hits these unconditionally;
// callers are responsible for making clear in the UI that this is a global
// edit, not scoped to the currently open resume (see spec.md's "single most
// important conceptual point").
// ---------------------------------------------------------------------------

export function createExperience(data: {
  company: string;
  title: string;
  dateRange: string;
  location: string;
}): Promise<Experience> {
  return requestJson<Experience>('/api/experiences', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
}

export function updateExperience(
  id: string,
  patch: Partial<{
    company: string;
    title: string;
    dateRange: string;
    location: string;
    isArchived: boolean;
  }>,
): Promise<Experience> {
  return requestJson<Experience>(`/api/experiences/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

export function createExperienceBullet(experienceId: string, content: string): Promise<Bullet> {
  return requestJson<Bullet>(`/api/experiences/${experienceId}/bullets`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content }),
  });
}

export function updateExperienceBullet(
  id: string,
  patch: Partial<{ content: string; isArchived: boolean }>,
): Promise<Bullet> {
  return requestJson<Bullet>(`/api/experience-bullets/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

export function createProject(data: {
  name: string;
  technologies: string;
  dateRange: string;
}): Promise<Project> {
  return requestJson<Project>('/api/projects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
}

export function updateProject(
  id: string,
  patch: Partial<{ name: string; technologies: string; dateRange: string; isArchived: boolean }>,
): Promise<Project> {
  return requestJson<Project>(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

export function createProjectBullet(projectId: string, content: string): Promise<Bullet> {
  return requestJson<Bullet>(`/api/projects/${projectId}/bullets`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content }),
  });
}

export function updateProjectBullet(
  id: string,
  patch: Partial<{ content: string; isArchived: boolean }>,
): Promise<Bullet> {
  return requestJson<Bullet>(`/api/project-bullets/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

export function createSkillRow(data: {
  name: string;
  top: boolean;
  separator?: string;
}): Promise<SkillRow> {
  return requestJson<SkillRow>('/api/skill-rows', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
}

export function updateSkillRow(
  id: string,
  patch: Partial<{ name: string; top: boolean; separator: string; isArchived: boolean }>,
): Promise<SkillRow> {
  return requestJson<SkillRow>(`/api/skill-rows/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

export function createSkill(skillRowId: string, name: string): Promise<Skill> {
  return requestJson<Skill>(`/api/skill-rows/${skillRowId}/skills`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
}

export function updateSkill(
  id: string,
  patch: Partial<{ name: string; isArchived: boolean }>,
): Promise<Skill> {
  return requestJson<Skill>(`/api/skills/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

/** `PATCH /api/templates/:id` — global; T9 owns the Template tab UI that calls this. */
export function updateTemplate(
  id: string,
  patch: Partial<{ name: string; content: string; isArchived: boolean }>,
): Promise<Template> {
  return requestJson<Template>(`/api/templates/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
}

/**
 * `GET /api/resumes/:id/pdf` — downloads the most recently *saved* PDF
 * snapshot (not a fresh render) and saves it client-side using the
 * filename the server provides via `Content-Disposition`. Throws `ApiError`
 * with status 404 if the resume has never been saved as a PDF.
 */
export async function downloadResumePdf(id: string): Promise<void> {
  const response = await authedFetch(`/api/resumes/${id}/pdf`);
  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  const filename =
    extractFilename(response.headers.get('content-disposition')) ?? `resume-${id}.pdf`;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extractFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  // Matches both `filename="foo.pdf"` and unquoted `filename=foo.pdf`.
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
  return match?.[1]?.trim() ?? null;
}

// ---------------------------------------------------------------------------
// Feedback — the floating "Give feedback" widget's only network call.
// Sends multipart (not JSON) because a screenshot rides along; deliberately
// sets no `content-type` so the browser writes the multipart boundary.
// ---------------------------------------------------------------------------

export interface FeedbackResult {
  number: number;
  url: string;
  /** False if the issue was filed but its screenshot couldn't be uploaded. */
  screenshotUploaded: boolean;
}

export interface FeedbackInput {
  kind: FeedbackKind;
  description: string;
  url: string;
  viewport?: string;
  userAgent?: string;
  screenshot?: File | null;
}

/** `POST /api/feedback` — creates a GitHub issue. `503` means the deployment
 *  has no `GITHUB_TOKEN`; `502` means GitHub itself refused. */
export function submitFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const form = new FormData();
  form.set('kind', input.kind);
  form.set('description', input.description);
  form.set('url', input.url);
  if (input.viewport) form.set('viewport', input.viewport);
  if (input.userAgent) form.set('userAgent', input.userAgent);
  if (input.screenshot) form.set('screenshot', input.screenshot, input.screenshot.name);

  return requestJson<FeedbackResult>('/api/feedback', { method: 'POST', body: form });
}
