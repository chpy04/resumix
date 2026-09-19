import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createExperience } from '@/lib/queries/experiences';
import { createExperienceSchema } from '@/lib/validation';

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const body = await parseJsonBody(request, createExperienceSchema);
    const created = await createExperience(body);
    return Response.json(created, { status: 201 });
  });
}
