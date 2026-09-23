import { type RouteContext, withApiErrors } from '@/lib/http';
import { attachCoverLetter } from '@/lib/queries/applications';
import { requireUserId } from '@/lib/session';

/**
 * "Add a cover letter": copies the caller's default letter under this
 * application's company name and links it. Returns the updated application.
 *
 * Its own endpoint rather than a flag on create, because a cover letter is
 * a later decision than the resume — plenty of postings never ask for one.
 * Linking a letter that already exists is `PATCH { coverLetterId }` instead.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    return Response.json(await attachCoverLetter(userId, id), { status: 201 });
  });
}
