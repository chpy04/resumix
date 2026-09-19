import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { deleteResume, getResumeDetail, updateResume } from '@/lib/queries/resumes';
import { NotFoundError } from '@/lib/queries/errors';
import { patchResumeSchema } from '@/lib/validation';

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const detail = await getResumeDetail(id);
    if (!detail) throw new NotFoundError(`resume ${id} not found`);
    return Response.json(detail);
  });
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const body = await parseJsonBody(request, patchResumeSchema);
    const summary = await updateResume(id, body);
    return Response.json(summary);
  });
}

export async function DELETE(_request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    await deleteResume(id);
    return new Response(null, { status: 204 });
  });
}
