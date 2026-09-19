import { compileTex, LatexServiceError } from '@/lib/latex';
import { parseJsonBody, withApiErrors } from '@/lib/http';
import { renderResumeById } from '@/lib/queries/render';
import { renderBodySchema } from '@/lib/validation';
import type { RenderResult } from '@/lib/types';
import { requireUserId } from '@/lib/session';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Preview only — never persists. `templateOverride` lets the Template tab
 * preview unsaved LaTeX. A LaTeX compile failure is a normal `200` with
 * `ok: false`, never a 500 (docs/API.md).
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, renderBodySchema);

    const { tex, warnings } = await renderResumeById(userId, id, body.templateOverride);

    let compiled;
    try {
      compiled = await compileTex(tex);
    } catch (err) {
      if (err instanceof LatexServiceError) {
        const result: RenderResult = {
          ok: false,
          pages: null,
          errors: [err.message],
          warnings,
          log: '',
        };
        return Response.json(result);
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
