/**
 * Rendering the resume an application is holding, and freezing the result
 * into a `resume_pdf` snapshot the application can point at.
 *
 * Two routes need exactly this — "save this resume to the application" and
 * "mark it applied" — and the difference between them is only what they do to
 * the status afterwards, so the render/compile/store half lives here rather
 * than being written twice. Final approval and `submit_for_review` need the
 * compile without the store, so the two halves are separate functions:
 * approval compiles everything before it writes anything (D-044).
 *
 * A LaTeX compile failure is a normal outcome, not an exception: it comes
 * back as `ok: false` carrying the same `{ pages, errors, warnings, log }`
 * body the resume routes return, and nothing is stored (docs/API.md).
 */
import { buildResumeFilename } from './filename.ts';
import { compileTex, latexUnavailableResult, LatexServiceError } from './latex.ts';
import { renderResumeById } from './queries/render.ts';
import { saveResumePdfSnapshot, type NewPdfSnapshot } from './storage.ts';

export interface SnapshotFailure {
  ok: false;
  pages: number | null;
  errors: string[];
  warnings: string[];
  log: string;
}

export type SnapshotResult = { ok: true; resumePdfId: string } | SnapshotFailure;

/**
 * A compiled resume, named and ready to store, with nothing stored yet. A
 * failure says whether the sidecar was unreachable, which only a caller that
 * words its own message needs; `snapshotResumeForApplication` drops it.
 */
export type CompiledResume =
  | { ok: true; pages: number | null; snapshot: NewPdfSnapshot }
  | (SnapshotFailure & { unavailable: boolean });

export async function compileResumeForApplication(
  userId: string,
  input: { resumeId: string; company: string },
): Promise<CompiledResume> {
  const { tex, warnings } = await renderResumeById(userId, input.resumeId);

  let compiled;
  try {
    compiled = await compileTex(tex);
  } catch (err) {
    if (err instanceof LatexServiceError) {
      // `RenderResult.ok` is a plain boolean; this arm is always a failure.
      const unavailable = latexUnavailableResult(err, warnings);
      return { ...unavailable, ok: false, unavailable: true };
    }
    throw err;
  }

  if (!compiled.ok || !compiled.pdfBase64) {
    return {
      ok: false,
      unavailable: false,
      pages: compiled.pages,
      errors: compiled.errors,
      warnings,
      log: compiled.log,
    };
  }

  return {
    ok: true,
    pages: compiled.pages,
    snapshot: {
      // Named for the company applied to, which is what this PDF is *for* —
      // the resume it was rendered from may be called anything.
      filename: buildResumeFilename(input.company),
      bytes: Buffer.from(compiled.pdfBase64, 'base64'),
      tex,
    },
  };
}

export async function snapshotResumeForApplication(
  userId: string,
  input: { resumeId: string; company: string },
): Promise<SnapshotResult> {
  const compiled = await compileResumeForApplication(userId, input);
  if (!compiled.ok) {
    // The routes return this as their body, which docs/API.md fixes.
    const { unavailable: _, ...failure } = compiled;
    return failure;
  }

  const snapshot = await saveResumePdfSnapshot(input.resumeId, compiled.snapshot);
  return { ok: true, resumePdfId: snapshot.id };
}
