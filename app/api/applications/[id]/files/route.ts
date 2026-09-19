import { MAX_ATTACHMENT_BYTES, sanitizeAttachmentFilename } from '@/lib/applications/attachments';
import { type RouteContext, withApiErrors } from '@/lib/http';
import { addApplicationFile } from '@/lib/queries/application-files';
import { BadRequestError } from '@/lib/queries/errors';
import { requireUserId } from '@/lib/session';

/**
 * Attaches a file to an application — a cover letter, a take-home, an offer
 * letter, anything. `multipart/form-data` rather than JSON for the same
 * reason `/api/feedback` uses it: base64-in-JSON would inflate the body ~33%
 * against Vercel's 4.5 MB ceiling.
 *
 * No type restriction, on purpose (D-031). What comes *back* is constrained
 * instead — see `GET /api/application-files/:id`.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new BadRequestError('expected a multipart/form-data body');
    }

    const file = form.get('file');
    if (!file || typeof file === 'string') {
      throw new BadRequestError('file is required');
    }
    if (file.size === 0) {
      throw new BadRequestError('file is empty');
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestError(
        `file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
      );
    }

    const stored = await addApplicationFile(userId, id, {
      filename: sanitizeAttachmentFilename(file.name),
      contentType: file.type || 'application/octet-stream',
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    return Response.json(stored, { status: 201 });
  });
}
