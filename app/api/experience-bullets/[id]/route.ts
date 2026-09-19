import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { updateExperienceBullet } from '@/lib/queries/experience-bullets';
import { patchBulletSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchBulletSchema);
    const updated = await updateExperienceBullet(userId, id, body);
    return Response.json(updated);
  });
}
