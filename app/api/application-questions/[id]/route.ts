import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { updateApplicationQuestion } from '@/lib/queries/application-questions';
import { requireUserId } from '@/lib/session';
import { patchApplicationQuestionSchema } from '@/lib/validation';

/**
 * Edits one question's answer, switches its mode, or asks the agent for a
 * redraft. Any accepted write unapproves the question and, in review,
 * clears the application's final approval, so a Ready one goes back to
 * Needs review (C3, D-047). Refused once the application has been sent.
 */
export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchApplicationQuestionSchema);
    return Response.json(await updateApplicationQuestion(userId, id, body));
  });
}
