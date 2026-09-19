import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createApplication, listApplications } from '@/lib/queries/applications';
import { requireUserId } from '@/lib/session';
import { createApplicationSchema } from '@/lib/validation';

export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('includeArchived') === '1';
    return Response.json(await listApplications(userId, includeArchived));
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const body = await parseJsonBody(request, createApplicationSchema);
    return Response.json(await createApplication(userId, body), { status: 201 });
  });
}
