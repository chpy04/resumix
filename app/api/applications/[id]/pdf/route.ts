import { snapshotResumeForApplication } from '@/lib/application-pdf';
import { sanitizeForHeader } from '@/lib/filename';
import { errorResponse, type RouteContext, withApiErrors } from '@/lib/http';
import { getApplicationRow, pinResumePdf } from '@/lib/queries/applications';
import { BadRequestError, NotFoundError } from '@/lib/queries/errors';
import { requireUserId } from '@/lib/session';
import { getResumePdfSnapshotById } from '@/lib/storage';

/**
 * "Save this resume to the application": renders the linked resume, stores a
 * `resume_pdf` snapshot, and points the application at it — without touching
 * the status. Editing a resume from inside an application and saving it back
 * is the normal loop; declaring it sent is a separate decision.
 *
 * Same failure contract as every other render: `200 { ok: false, ... }` and
 * nothing stored.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const row = await getApplicationRow(userId, id);
    if (!row) throw new NotFoundError(`application ${id} not found`);
    if (!row.resumeId) {
      throw new BadRequestError(`application ${id} has no resume linked`);
    }

    const snapshot = await snapshotResumeForApplication(userId, {
      resumeId: row.resumeId,
      company: row.company,
    });
    if (!snapshot.ok) return Response.json(snapshot);

    return Response.json({
      ok: true,
      application: await pinResumePdf(userId, id, snapshot.resumePdfId),
    });
  });
}

/**
 * The exact PDF this application is holding — never a fresh render, and never
 * the resume's *latest* snapshot either. Editing the resume afterwards is
 * expected; this still hands back what was saved here.
 *
 * `404` until something has been saved to it.
 */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const row = await getApplicationRow(userId, id);
    if (!row) throw new NotFoundError(`application ${id} not found`);
    if (!row.resumePdfId) {
      return errorResponse(`application ${id} has no saved resume PDF yet`, 404);
    }

    const snapshot = await getResumePdfSnapshotById(row.resumePdfId);
    if (!snapshot) {
      return errorResponse(`application ${id} has no saved resume PDF yet`, 404);
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
