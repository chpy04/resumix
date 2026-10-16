import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { approveApplicationQuestions } from '@/lib/queries/application-questions';
import { requireUserId } from '@/lib/session';
import { approveQuestionsSchema } from '@/lib/validation';

/**
 * Approves these questions of one application, all or none: only in Needs
 * review, and only answers that can be approved; a `400` lists every one
 * that cannot (D-047). Nested under the application rather than the
 * question because one call approves several.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const { questionIds } = await parseJsonBody(request, approveQuestionsSchema);
    return Response.json(await approveApplicationQuestions(userId, id, questionIds));
  });
}
