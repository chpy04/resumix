import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createSkillRow } from '@/lib/queries/skill-rows';
import { createSkillRowSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const body = await parseJsonBody(request, createSkillRowSchema);
    const created = await createSkillRow(userId, body);
    return Response.json(created, { status: 201 });
  });
}
