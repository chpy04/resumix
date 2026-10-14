import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { resolveBulletSuggestion } from '@/lib/queries/bullet-suggestions';
import { requireUserId } from '@/lib/session';
import { resolveBulletSuggestionSchema } from '@/lib/validation';

/**
 * Applies, saves as new, or rejects one suggestion: the only way an agent's
 * suggestion reaches the library or the selection (D-045). A `400` when it
 * has already been resolved or its application is not in Needs review, and
 * nothing is written.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const { action } = await parseJsonBody(request, resolveBulletSuggestionSchema);
    return Response.json(await resolveBulletSuggestion(userId, id, action));
  });
}
