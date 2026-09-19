import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createSkillRow } from '@/lib/queries/skill-rows';
import { createSkillRowSchema } from '@/lib/validation';

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const body = await parseJsonBody(request, createSkillRowSchema);
    const created = await createSkillRow(body);
    return Response.json(created, { status: 201 });
  });
}
