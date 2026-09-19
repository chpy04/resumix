import { buildResumeFilename } from '@/lib/filename';
import { type RouteContext, withApiErrors } from '@/lib/http';
import { compileTex, latexUnavailableResult, LatexServiceError } from '@/lib/latex';
import { getApplicationRow, recordApplied } from '@/lib/queries/applications';
import { NotFoundError } from '@/lib/queries/errors';
import { renderResumeById } from '@/lib/queries/render';
import { requireUserId } from '@/lib/session';
import { saveResumePdfSnapshot } from '@/lib/storage';

/**
 * Marks an application as sent.
 *
 * With a resume linked, this is the moment the live resume becomes a fixed
 * record: it renders and compiles it, stores a `resume_pdf` snapshot, and
 * pins the application to those bytes — while leaving `resumeId` alone, so
 * the application still knows which resume it came from (D-031).
 *
 * With no resume linked it just stamps the status, which is how an
 * application sent from somewhere else gets logged.
 *
 * A LaTeX compile failure changes nothing and comes back as
 * `200 { ok: false, errors, warnings, log }`, exactly as it does for
 * `POST /api/resumes/:id/pdf` — a broken template is a normal state of the
 * editor, not a server fault.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const row = await getApplicationRow(userId, id);
    if (!row) throw new NotFoundError(`application ${id} not found`);

    if (!row.resumeId) {
      return Response.json({ ok: true, application: await recordApplied(userId, id, null) });
    }

    const { tex, warnings } = await renderResumeById(userId, row.resumeId);

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

    // Named for the company applied to, which is what this PDF is *for* —
    // the resume it was rendered from may be called anything.
    const filename = buildResumeFilename(row.company);
    const snapshot = await saveResumePdfSnapshot(row.resumeId, {
      filename,
      bytes: Buffer.from(compiled.pdfBase64, 'base64'),
      tex,
    });

    return Response.json({ ok: true, application: await recordApplied(userId, id, snapshot.id) });
  });
}
