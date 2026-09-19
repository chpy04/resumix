import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { updateProjectBullet } from '@/lib/queries/project-bullets';
import { patchBulletSchema } from '@/lib/validation';

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const body = await parseJsonBody(request, patchBulletSchema);
    const updated = await updateProjectBullet(id, body);
    return Response.json(updated);
  });
}
