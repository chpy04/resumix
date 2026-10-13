import { approveApplication } from '@/lib/application-approval';
import { type RouteContext, withApiErrors } from '@/lib/http';
import { requireUserId } from '@/lib/session';

/**
 * Final approval: compiles the resume and the letter, then stores and pins
 * the resume snapshot, stores the letter's PDF as an attachment, and moves
 * the application to `ready` (C3, C4, D-044).
 *
 * A section left unapproved is a `400` listing what to approve first. A
 * LaTeX failure in either document is `200 { ok: false, … }`, its errors
 * prefixed `Resume:` or `Cover letter:`, and nothing is written, the same
 * contract as `POST /pdf` and `POST /apply`.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    return Response.json(await approveApplication(userId, id));
  });
}
