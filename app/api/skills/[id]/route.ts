import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { updateSkill } from '@/lib/queries/skills';
import { patchSkillSchema } from '@/lib/validation';

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const body = await parseJsonBody(request, patchSkillSchema);
    const updated = await updateSkill(id, body);
    return Response.json(updated);
  });
}
