import { buildCoverLetterFilename, sanitizeForHeader } from '@/lib/filename';
import { errorResponse, type RouteContext, withApiErrors } from '@/lib/http';
import { compileTex, LatexServiceError } from '@/lib/latex';
import { getCoverLetterRow } from '@/lib/queries/cover-letters';
import { NotFoundError } from '@/lib/queries/errors';
import { requireUserId } from '@/lib/session';

/**
 * Compiles the stored letter and streams the PDF.
 *
 * Deliberately a fresh compile, where the resume's `GET /pdf` serves frozen
 * bytes. A resume's saved PDF has to be frozen because the content under it
 * is shared and can change without anyone touching that resume; a cover
 * letter is a private document that only changes when you edit it, so
 * storing a second copy of the same bytes would buy nothing (D-035).
 *
 * **This is the one place in the app where a LaTeX error is an HTTP error.**
 * Everywhere else a compile failure is `200 { ok: false, errors }`, because
 * there is a JSON envelope to put it in; a binary download has none, and a
 * `.pdf` that is secretly an error object is worse than a 400. The editor
 * never hits this path — it downloads the bytes it has already previewed.
 */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const row = await getCoverLetterRow(userId, id);
    if (!row) throw new NotFoundError(`cover letter ${id} not found`);

    let compiled;
    try {
      compiled = await compileTex(row.content);
    } catch (err) {
      if (err instanceof LatexServiceError) return errorResponse(err.message, 502);
      throw err;
    }

    if (!compiled.ok || !compiled.pdfBase64) {
      return errorResponse(compiled.errors[0] ?? `cover letter ${id} does not compile`, 400);
    }

    const bytes = Buffer.from(compiled.pdfBase64, 'base64');
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${sanitizeForHeader(buildCoverLetterFilename(row.name))}"`,
        'content-length': String(bytes.byteLength),
      },
    });
  });
}
