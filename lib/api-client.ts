/**
 * Typed client for the routes documented in `docs/API.md`. This is the only
 * module that knows URL shapes — every component calls through here so the
 * URLs, request bodies, and response parsing live in exactly one place.
 *
 * Every request goes through `authedFetch` (never bare `fetch`), per project
 * convention: it attaches the stored token and handles 401 -> logout.
 */

import { authedFetch } from '@/lib/auth-client';
import type { ResumeSummary } from '@/lib/types';

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

/** `GET /api/resumes` — default first, then most-recently-created first. */
export function listResumes(): Promise<ResumeSummary[]> {
  return requestJson<ResumeSummary[]>('/api/resumes');
}

/** `POST /api/resumes` — clones the default resume's template + selections. */
export function createResume(name: string): Promise<ResumeSummary> {
  return requestJson<ResumeSummary>('/api/resumes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

/** `DELETE /api/resumes/:id` — 400s server-side if this is the default resume. */
export function deleteResume(id: string): Promise<void> {
  return requestJson<void>(`/api/resumes/${id}`, { method: 'DELETE' });
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

  const filename = extractFilename(response.headers.get('content-disposition')) ?? `resume-${id}.pdf`;
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
