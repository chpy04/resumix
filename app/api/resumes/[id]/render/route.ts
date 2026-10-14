import { compileTex, latexUnavailableResult, LatexServiceError } from '@/lib/latex';
import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { previewSuggestions } from '@/lib/queries/bullet-suggestions';
import { renderResumeById } from '@/lib/queries/render';
import { renderBodySchema } from '@/lib/validation';
import type { RenderResult } from '@/lib/types';
import { requireUserId } from '@/lib/session';

/**
 * Preview only — never persists. `templateOverride` lets the Template tab
 * preview unsaved LaTeX, and `suggestionsFor` lays that application's
 * pending bullet suggestions over it, for the review page (D-045). A LaTeX
 * compile failure is a normal `200` with `ok: false`, never a 500
 * (docs/API.md).
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, renderBodySchema);

    const suggestions = body.suggestionsFor
      ? await previewSuggestions(userId, body.suggestionsFor, id)
      : undefined;
    const { tex, warnings } = await renderResumeById(
      userId,
      id,
      body.templateOverride,
      suggestions,
    );

    let compiled;
    try {
      compiled = await compileTex(tex);
    } catch (err) {
      if (err instanceof LatexServiceError) {
        return Response.json(latexUnavailableResult(err, warnings));
      }
      throw err;
    }

    const result: RenderResult = {
      ok: compiled.ok,
      pdfBase64: compiled.pdfBase64,
      pages: compiled.pages,
      errors: compiled.errors,
      warnings,
      log: compiled.log,
    };
    return Response.json(result);
  });
}
