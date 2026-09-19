import { parseJsonBody, withApiErrors } from '@/lib/http';
import { updateTemplate } from '@/lib/queries/templates';
import { patchTemplateSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchTemplateSchema);
    const updated = await updateTemplate(userId, id, body);
    return Response.json(updated);
  });
}
