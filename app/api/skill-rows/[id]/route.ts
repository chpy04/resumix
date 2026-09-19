import { parseJsonBody, withApiErrors } from '@/lib/http';
import { updateSkillRow } from '@/lib/queries/skill-rows';
import { patchSkillRowSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchSkillRowSchema);
    const updated = await updateSkillRow(userId, id, body);
    return Response.json(updated);
  });
}
