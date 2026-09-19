import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createExperienceBullet } from '@/lib/queries/experience-bullets';
import { NotFoundError } from '@/lib/queries/errors';
import { getExperienceById } from '@/lib/queries/experiences';
import { createBulletSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const experience = await getExperienceById(userId, id);
    if (!experience) throw new NotFoundError(`experience ${id} not found`);

    const body = await parseJsonBody(request, createBulletSchema);
    const created = await createExperienceBullet(userId, id, body.content);
    return Response.json(created, { status: 201 });
  });
}
