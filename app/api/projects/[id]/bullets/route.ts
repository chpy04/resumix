import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { createProjectBullet } from '@/lib/queries/project-bullets';
import { NotFoundError } from '@/lib/queries/errors';
import { getProjectById } from '@/lib/queries/projects';
import { createBulletSchema } from '@/lib/validation';

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const project = await getProjectById(id);
    if (!project) throw new NotFoundError(`project ${id} not found`);

    const body = await parseJsonBody(request, createBulletSchema);
    const created = await createProjectBullet(id, body.content);
    return Response.json(created, { status: 201 });
  });
}
