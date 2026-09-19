import { parseJsonBody, withApiErrors } from '@/lib/http';
import { updateExperience } from '@/lib/queries/experiences';
import { patchExperienceSchema } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const body = await parseJsonBody(request, patchExperienceSchema);
    const updated = await updateExperience(id, body);
    return Response.json(updated);
  });
}
