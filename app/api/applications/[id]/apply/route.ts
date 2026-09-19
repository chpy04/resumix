import { snapshotResumeForApplication } from '@/lib/application-pdf';
import { type RouteContext, withApiErrors } from '@/lib/http';
import { getApplicationRow, recordApplied } from '@/lib/queries/applications';
import { NotFoundError } from '@/lib/queries/errors';
import { requireUserId } from '@/lib/session';

/**
 * Marks an application as sent — which is also what moves it off the pipeline
 * board and into the Applied table, where most applications quietly stay.
 *
 * If the linked resume has not been saved to this application yet, this takes
 * that snapshot first, so "apply" never leaves a sent application with no
 * record of what went out. If it already has one — you saved from the editor
 * and then came back — that snapshot stands; this does not silently re-render.
 *
 * A LaTeX compile failure changes nothing and comes back as
 * `200 { ok: false, errors, warnings, log }`, the same answer
 * `POST /api/resumes/:id/pdf` gives.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const row = await getApplicationRow(userId, id);
    if (!row) throw new NotFoundError(`application ${id} not found`);

    if (!row.resumeId || row.resumePdfId) {
      return Response.json({ ok: true, application: await recordApplied(userId, id, null) });
    }

    const snapshot = await snapshotResumeForApplication(userId, {
      resumeId: row.resumeId,
      company: row.company,
    });
    if (!snapshot.ok) return Response.json(snapshot);

    return Response.json({
      ok: true,
      application: await recordApplied(userId, id, snapshot.resumePdfId),
    });
  });
}
