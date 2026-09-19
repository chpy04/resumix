import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createExperience } from '@/lib/queries/experiences';
import { createExperienceSchema } from '@/lib/validation';
import { requireUserId } from '@/lib/session';

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const body = await parseJsonBody(request, createExperienceSchema);
    const created = await createExperience(userId, body);
    return Response.json(created, { status: 201 });
  });
}
