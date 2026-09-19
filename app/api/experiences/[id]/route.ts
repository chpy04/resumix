import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { updateExperience } from '@/lib/queries/experiences';
import { patchExperienceSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchExperienceSchema);
    const updated = await updateExperience(userId, id, body);
    return Response.json(updated);
  });
}
