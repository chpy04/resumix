import { parseJsonBody, withApiErrors } from '@/lib/http';
import { updateSkill } from '@/lib/queries/skills';
import { patchSkillSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchSkillSchema);
    const updated = await updateSkill(userId, id, body);
    return Response.json(updated);
  });
}
