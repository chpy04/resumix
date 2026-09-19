import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { updateTemplate } from '@/lib/queries/templates';
import { patchTemplateSchema } from '@/lib/validation';

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const body = await parseJsonBody(request, patchTemplateSchema);
    const updated = await updateTemplate(id, body);
    return Response.json(updated);
  });
}
