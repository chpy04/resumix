import { parseJsonBody, withApiErrors } from '@/lib/http';
import { NotFoundError } from '@/lib/queries/errors';
import { getSkillRowById } from '@/lib/queries/skill-rows';
import { createSkill } from '@/lib/queries/skills';
import { createSkillSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const row = await getSkillRowById(userId, id);
    if (!row) throw new NotFoundError(`skill row ${id} not found`);

    const body = await parseJsonBody(request, createSkillSchema);
    const created = await createSkill(userId, id, body.name);
    return Response.json(created, { status: 201 });
  });
}
