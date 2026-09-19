import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createProject } from '@/lib/queries/projects';
import { createProjectSchema } from '@/lib/validation';

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const body = await parseJsonBody(request, createProjectSchema);
    const created = await createProject(body);
    return Response.json(created, { status: 201 });
  });
}
