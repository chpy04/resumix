import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { approveSection } from '@/lib/queries/applications';
import { requireUserId } from '@/lib/session';
import { approveSectionSchema } from '@/lib/validation';

/**
 * Approves one section of the review: `resume` or `coverLetter`. Only while
 * the application is in Needs review, and only a section it has; anything
 * else is a `400` saying why. Editing that section afterwards clears the
 * approval again (D-044).
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const { section } = await parseJsonBody(request, approveSectionSchema);
    return Response.json(await approveSection(userId, id, section));
  });
}
