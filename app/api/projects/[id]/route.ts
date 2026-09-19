import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { updateProject } from '@/lib/queries/projects';
import { patchProjectSchema } from '@/lib/validation';

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const body = await parseJsonBody(request, patchProjectSchema);
    const updated = await updateProject(id, body);
    return Response.json(updated);
  });
}
