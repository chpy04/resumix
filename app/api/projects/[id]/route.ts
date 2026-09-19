import { parseJsonBody, withApiErrors } from '@/lib/http';
import { updateProject } from '@/lib/queries/projects';
import { patchProjectSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchProjectSchema);
    const updated = await updateProject(userId, id, body);
    return Response.json(updated);
  });
}
