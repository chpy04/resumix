import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createResume, listResumeSummaries } from '@/lib/queries/resumes';
import { createResumeSchema } from '@/lib/validation';

export async function GET(): Promise<Response> {
  return withApiErrors(async () => {
    const resumes = await listResumeSummaries();
    return Response.json(resumes);
  });
}

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const body = await parseJsonBody(request, createResumeSchema);
    const summary = await createResume(body.name);
    return Response.json(summary, { status: 201 });
  });
}
