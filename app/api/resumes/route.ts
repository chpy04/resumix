import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createResume, listResumeSummaries } from '@/lib/queries/resumes';
import { requireUserId } from '@/lib/session';
import { createResumeSchema } from '@/lib/validation';

export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const resumes = await listResumeSummaries(userId);
    return Response.json(resumes);
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const body = await parseJsonBody(request, createResumeSchema);
    const summary = await createResume(userId, body.name);
    return Response.json(summary, { status: 201 });
  });
}
