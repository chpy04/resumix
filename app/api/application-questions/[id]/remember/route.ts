import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { setQuestionRemembered } from '@/lib/queries/application-questions';
import { requireUserId } from '@/lib/session';
import { rememberAnswerSchema } from '@/lib/validation';

/**
 * "Remember this answer": ticking saves the question's answer as a saved
 * answer, or updates the one it is linked to; unticking archives that one.
 * A PUT, because it sets a state and repeating it changes nothing. Never
 * unapproves or reopens anything, which is why it is not the PATCH (D-048).
 */
export async function PUT(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const { remember } = await parseJsonBody(request, rememberAnswerSchema);
    return Response.json(await setQuestionRemembered(userId, id, remember));
  });
}
