import { parseJsonBody, withApiErrors } from '@/lib/http';
import { updateExperienceBullet } from '@/lib/queries/experience-bullets';
import { patchBulletSchema } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const body = await parseJsonBody(request, patchBulletSchema);
    const updated = await updateExperienceBullet(id, body);
    return Response.json(updated);
  });
}
