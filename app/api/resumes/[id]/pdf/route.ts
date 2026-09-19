import { compileTex, latexUnavailableResult, LatexServiceError } from '@/lib/latex';
import { errorResponse, type RouteContext, withApiErrors } from '@/lib/http';
import { buildResumeFilename, sanitizeForHeader } from '@/lib/filename';
import { NotFoundError } from '@/lib/queries/errors';
import { renderResumeById } from '@/lib/queries/render';
import { getResumeRow } from '@/lib/queries/resumes';
import { getLatestResumePdfSnapshot, saveResumePdfSnapshot } from '@/lib/storage';
import { requireUserId } from '@/lib/session';

/**
 * Renders, compiles, and stores a `resume_pdf` snapshot. A LaTeX compile
 * failure does not save anything — it comes back as `200 { ok: false,
 * errors, warnings, log }`, the same shape `/render` uses, since there is
 * no PDF to name/store. On success: `{ ok: true, filename, createdAt }`.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const resumeRow = await getResumeRow(userId, id);
    if (!resumeRow) throw new NotFoundError(`resume ${id} not found`);

    const { tex, warnings } = await renderResumeById(userId, id);

    let compiled;
    try {
      compiled = await compileTex(tex);
    } catch (err) {
      if (err instanceof LatexServiceError) {
        return Response.json(latexUnavailableResult(err, warnings));
      }
      throw err;
    }

    if (!compiled.ok || !compiled.pdfBase64) {
      return Response.json({
        ok: false,
        pages: compiled.pages,
        errors: compiled.errors,
        warnings,
        log: compiled.log,
      });
    }

    const filename = buildResumeFilename(resumeRow.name);
    const bytes = Buffer.from(compiled.pdfBase64, 'base64');
    const meta = await saveResumePdfSnapshot(id, { filename, bytes, tex });

    return Response.json({ ok: true, filename: meta.filename, createdAt: meta.createdAt });
  });
}

/**
 * Returns the latest stored snapshot as `application/pdf` — never a fresh
 * render. `404` if the resume has never been saved (docs/API.md's
 * anti-drift guarantee).
 */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const resumeRow = await getResumeRow(userId, id);
    if (!resumeRow) throw new NotFoundError(`resume ${id} not found`);

    const snapshot = await getLatestResumePdfSnapshot(id);
    if (!snapshot) {
      return errorResponse(`resume ${id} has no saved PDF yet`, 404);
    }

    return new Response(new Uint8Array(snapshot.bytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${sanitizeForHeader(snapshot.filename)}"`,
        'content-length': String(snapshot.bytes.byteLength),
      },
    });
  });
}
