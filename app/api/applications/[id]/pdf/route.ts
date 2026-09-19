import { sanitizeForHeader } from '@/lib/filename';
import { errorResponse, type RouteContext, withApiErrors } from '@/lib/http';
import { getApplicationRow } from '@/lib/queries/applications';
import { NotFoundError } from '@/lib/queries/errors';
import { requireUserId } from '@/lib/session';
import { getResumePdfSnapshotById } from '@/lib/storage';

/**
 * The exact PDF this application was sent with — never a fresh render, and
 * never the resume's *latest* snapshot either. Editing the resume afterwards
 * is expected; this still hands back what the company received.
 *
 * `404` while the application is a draft: there are no bytes yet.
 */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const row = await getApplicationRow(userId, id);
    if (!row) throw new NotFoundError(`application ${id} not found`);
    if (!row.resumePdfId) {
      return errorResponse(`application ${id} has not been sent with a resume`, 404);
    }

    const snapshot = await getResumePdfSnapshotById(row.resumePdfId);
    if (!snapshot) {
      return errorResponse(`application ${id} has not been sent with a resume`, 404);
    }

    return new Response(new Uint8Array(snapshot.bytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${sanitizeForHeader(snapshot.filename)}"`,
        'content-length': String(snapshot.bytes.byteLength),
      },
    });
  });
}
