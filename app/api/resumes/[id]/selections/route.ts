import { parseJsonBody, withApiErrors } from '@/lib/http';
import { NotFoundError } from '@/lib/queries/errors';
import { getResumeRow } from '@/lib/queries/resumes';
import { getSelections, replaceSelections } from '@/lib/queries/selections';
import { selectionsPatchSchema } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Autosave target. Replaces each slice present in the body wholesale inside
 * one transaction; slices absent from the body are untouched. Idempotent —
 * safe to call on every debounced keystroke. See docs/API.md.
 */
export async function PUT(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const resumeRow = await getResumeRow(id);
    if (!resumeRow) throw new NotFoundError(`resume ${id} not found`);

    const patch = await parseJsonBody(request, selectionsPatchSchema);
    await replaceSelections(id, patch);

    const selections = await getSelections(id);
    return Response.json(selections);
  });
}
