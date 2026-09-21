import { type RouteContext, parseJsonBody, withApiErrors } from '@/lib/http';
import { getCoverLetter, updateCoverLetter } from '@/lib/queries/cover-letters';
import { NotFoundError } from '@/lib/queries/errors';
import { requireUserId } from '@/lib/session';
import { patchCoverLetterSchema } from '@/lib/validation';

/** One letter, content included — this is the editor's whole payload. */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const letter = await getCoverLetter(userId, id);
    if (!letter) throw new NotFoundError(`cover letter ${id} not found`);
    return Response.json(letter);
  });
}

/** Rename, rewrite, or archive. There is no DELETE: with no PDF snapshot
 *  beside it, this text is the only record of what was sent (D-011, D-035). */
export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchCoverLetterSchema);
    return Response.json(await updateCoverLetter(userId, id, body));
  });
}
