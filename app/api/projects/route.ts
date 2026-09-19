import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createProject } from '@/lib/queries/projects';
import { createProjectSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const body = await parseJsonBody(request, createProjectSchema);
    const created = await createProject(userId, body);
    return Response.json(created, { status: 201 });
  });
}
