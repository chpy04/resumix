import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { updateBulletSuggestionText } from '@/lib/queries/bullet-suggestions';
import { requireUserId } from '@/lib/session';
import { patchBulletSuggestionSchema } from '@/lib/validation';

/** Chris's edit to a pending suggestion's text, autosaved from review step
 *  1. Only while it is pending and its application is in Needs review; a
 *  `400` says why otherwise (D-045). */
export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const { proposedText } = await parseJsonBody(request, patchBulletSuggestionSchema);
    return Response.json(await updateBulletSuggestionText(userId, id, proposedText));
  });
}
