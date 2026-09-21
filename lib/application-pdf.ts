/**
 * Rendering the resume an application is holding, and freezing the result
 * into a `resume_pdf` snapshot the application can point at.
 *
 * Two routes need exactly this — "save this resume to the application" and
 * "mark it applied" — and the difference between them is only what they do to
 * the status afterwards, so the render/compile/store half lives here rather
 * than being written twice.
 *
 * A LaTeX compile failure is a normal outcome, not an exception: it comes
 * back as `ok: false` carrying the same `{ pages, errors, warnings, log }`
 * body the resume routes return, and nothing is stored (docs/API.md).
 */
import { buildResumeFilename } from './filename.ts';
import { compileTex, latexUnavailableResult, LatexServiceError } from './latex.ts';
import { renderResumeById } from './queries/render.ts';
import { saveResumePdfSnapshot } from './storage.ts';

export interface SnapshotFailure {
  ok: false;
  pages: number | null;
  errors: string[];
  warnings: string[];
  log: string;
}

export type SnapshotResult = { ok: true; resumePdfId: string } | SnapshotFailure;

export async function snapshotResumeForApplication(
  userId: string,
  input: { resumeId: string; company: string },
): Promise<SnapshotResult> {
  const { tex, warnings } = await renderResumeById(userId, input.resumeId);

  let compiled;
  try {
    compiled = await compileTex(tex);
  } catch (err) {
    if (err instanceof LatexServiceError) {
      // `RenderResult.ok` is a plain boolean; this arm is always a failure.
      const unavailable = latexUnavailableResult(err, warnings);
      return { ...unavailable, ok: false };
    }
    throw err;
  }

  if (!compiled.ok || !compiled.pdfBase64) {
    return {
      ok: false,
      pages: compiled.pages,
      errors: compiled.errors,
      warnings,
      log: compiled.log,
    };
  }

  // Named for the company applied to, which is what this PDF is *for* — the
  // resume it was rendered from may be called anything.
  const snapshot = await saveResumePdfSnapshot(input.resumeId, {
    filename: buildResumeFilename(input.company),
    bytes: Buffer.from(compiled.pdfBase64, 'base64'),
    tex,
  });

  return { ok: true, resumePdfId: snapshot.id };
}
