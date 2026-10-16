import { compileTex, latexUnavailableResult, LatexServiceError } from '@/lib/latex';
import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { getCoverLetterRow } from '@/lib/queries/cover-letters';
import { NotFoundError } from '@/lib/queries/errors';
import { coverLetterTex } from '@/lib/render/cover-letter';
import { requireUserId } from '@/lib/session';
import type { RenderResult } from '@/lib/types';
import { renderCoverLetterSchema } from '@/lib/validation';

/**
 * Preview only — never persists, exactly like `POST /api/resumes/:id/render`.
 * `contentOverride` and `bodyOverride` are what the editor has on screen but
 * has not saved yet.
 *
 * There is no render step to speak of: a cover letter has no tokens and no
 * selections, so the `.tex` is the stored text, with the body, when there is
 * one, escaped into its `%%BODY%%` line (D-046). `warnings` is therefore
 * always empty, and kept in the response only so the shape matches the
 * resume's and one preview component can consume both.
 *
 * A LaTeX compile failure is a normal `200` with `ok: false`, never a 500,
 * and so is a body with no marker line to go to: on screen that is a draft
 * mid-edit, the same as a typo in the LaTeX.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, renderCoverLetterSchema);

    const row = await getCoverLetterRow(userId, id);
    if (!row) throw new NotFoundError(`cover letter ${id} not found`);

    const built = coverLetterTex(
      body.contentOverride ?? row.content,
      body.bodyOverride ?? row.body,
    );
    if (!built.ok) {
      const failed: RenderResult = {
        ok: false,
        pages: null,
        errors: [built.error],
        warnings: [],
        log: '',
      };
      return Response.json(failed);
    }

    let compiled;
    try {
      compiled = await compileTex(built.tex);
    } catch (err) {
      if (err instanceof LatexServiceError) {
        return Response.json(latexUnavailableResult(err, []));
      }
      throw err;
    }

    const result: RenderResult = {
      ok: compiled.ok,
      pdfBase64: compiled.pdfBase64,
      pages: compiled.pages,
      errors: compiled.errors,
      warnings: [],
      log: compiled.log,
    };
    return Response.json(result);
  });
}
