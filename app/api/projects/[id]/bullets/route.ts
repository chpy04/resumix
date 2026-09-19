import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createProjectBullet } from '@/lib/queries/project-bullets';
import { NotFoundError } from '@/lib/queries/errors';
import { getProjectById } from '@/lib/queries/projects';
import { createBulletSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const project = await getProjectById(userId, id);
    if (!project) throw new NotFoundError(`project ${id} not found`);

    const body = await parseJsonBody(request, createBulletSchema);
    const created = await createProjectBullet(userId, id, body.content);
    return Response.json(created, { status: 201 });
  });
}
