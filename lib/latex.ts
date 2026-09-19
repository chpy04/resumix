/**
 * Typed client for the sidecar latex service (services/latex). See
 * docs/API.md, "Latex service", for the frozen wire contract.
 */
import type { RenderResult } from './types.ts';

export interface LatexCompileResult {
  ok: boolean;
  /** Base64 PDF. Absent when compilation failed. */
  pdfBase64?: string;
  pages: number | null;
  /** `!`-prefixed LaTeX errors (with `l.NNN` context where available). */
  errors: string[];
  log: string;
  durationMs: number;
}

/** Thrown for anything that isn't a normal compile result: bad config,
 * network failure, timeout, or a non-2xx response from the service. */
export class LatexServiceError extends Error {}

/**
 * The `{ ok: false }` body `/render` and `/pdf` both return when the sidecar
 * itself could not be reached.
 *
 * The two failure modes stay distinct in this module — a LaTeX error is a
 * normal result, an unreachable service throws (.claude/rules/render-latex.md)
 * — and converge only at the HTTP boundary, because docs/API.md promises a
 * 200 either way: the editor keeps the last good preview on screen and shows
 * the message in `errors`. Shared so the two handlers cannot drift apart, and
 * typed so neither can widen past `RenderResult` the way one had begun to.
 */
export function latexUnavailableResult(err: LatexServiceError, warnings: string[]): RenderResult {
  return { ok: false, pages: null, errors: [err.message], warnings, log: '' };
}

const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * POSTs `tex` to `${LATEX_SERVICE_URL}/compile` and returns the parsed
 * result. A LaTeX compile failure is a normal result (`ok: false`) and does
 * NOT throw. This only throws when the service itself couldn't be reached
 * or reasoned about.
 */
export async function compileTex(
  tex: string,
  opts?: { timeoutMs?: number },
): Promise<LatexCompileResult> {
  const baseUrl = process.env.LATEX_SERVICE_URL;
  if (!baseUrl) {
    throw new LatexServiceError(
      'LATEX_SERVICE_URL is not configured. Set it to the latex service URL (e.g. http://latex:8080 in docker-compose).',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    const token = process.env.LATEX_SERVICE_TOKEN;
    res = await fetch(`${baseUrl.replace(/\/$/, '')}/compile`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Shared secret; the sidecar rejects unauthenticated calls when it is
        // configured with one. See docs/DEPLOYMENT.md.
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ tex }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LatexServiceError('The latex service timed out. Is it under heavy load?');
    }
    throw new LatexServiceError(
      "Could not reach the latex service. Is the 'latex' container running? (docker compose up -d latex)",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ?? '';
    } catch {
      // ignore — fall back to the plain status message below
    }
    throw new LatexServiceError(
      `latex service returned ${res.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  return (await res.json()) as LatexCompileResult;
}
