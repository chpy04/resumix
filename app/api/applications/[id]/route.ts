import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { getApplicationDetail, updateApplication } from '@/lib/queries/applications';
import { NotFoundError } from '@/lib/queries/errors';
import { requireUserId } from '@/lib/session';
import { patchApplicationSchema } from '@/lib/validation';

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const detail = await getApplicationDetail(userId, id);
    if (!detail) throw new NotFoundError(`application ${id} not found`);
    return Response.json(detail);
  });
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchApplicationSchema);
    return Response.json(await updateApplication(userId, id, body));
  });
}
