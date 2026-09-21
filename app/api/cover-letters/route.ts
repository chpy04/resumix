import { parseJsonBody, withApiErrors } from '@/lib/http';
import { createCoverLetter, listCoverLetters } from '@/lib/queries/cover-letters';
import { requireUserId } from '@/lib/session';
import { createCoverLetterSchema } from '@/lib/validation';

/** The caller's cover letters, default first then newest. Summaries only —
 *  the documents themselves are fetched one at a time by the editor. */
export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1';
    return Response.json(await listCoverLetters(userId, includeArchived));
  });
}

/** Copies the default (or `sourceCoverLetterId`) under a new name. The copy
 *  is literal — nothing about the company is substituted in (D-035). */
export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const body = await parseJsonBody(request, createCoverLetterSchema);
    const created = await createCoverLetter(userId, body.name, body.sourceCoverLetterId);
    return Response.json(created, { status: 201 });
  });
}
