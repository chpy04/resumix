import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { deleteResume, getResumeDetail, updateResume } from '@/lib/queries/resumes';
import { NotFoundError } from '@/lib/queries/errors';
import { requireUserId } from '@/lib/session';
import { patchResumeSchema } from '@/lib/validation';

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const detail = await getResumeDetail(userId, id);
    if (!detail) throw new NotFoundError(`resume ${id} not found`);
    return Response.json(detail);
  });
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchResumeSchema);
    const summary = await updateResume(userId, id, body);
    return Response.json(summary);
  });
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    await deleteResume(userId, id);
    return new Response(null, { status: 204 });
  });
}
