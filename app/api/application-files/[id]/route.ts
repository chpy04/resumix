import { sanitizeAttachmentFilename, servableContentType } from '@/lib/applications/attachments';
import { errorResponse, parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';
import { getApplicationFileBlob, updateApplicationFile } from '@/lib/queries/application-files';
import { requireUserId } from '@/lib/session';
import { patchApplicationFileSchema } from '@/lib/validation';

/**
 * Downloads an attachment.
 *
 * Always `Content-Disposition: attachment`, always `nosniff`, and the content
 * type is drawn from a fixed list rather than echoed back from the upload —
 * otherwise an uploaded HTML file would come back as a live page on this
 * origin, carrying the session with it.
 */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;

    const file = await getApplicationFileBlob(userId, id);
    if (!file) return errorResponse(`application file ${id} not found`, 404);

    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'content-type': servableContentType(file.contentType),
        'content-disposition': `attachment; filename="${sanitizeAttachmentFilename(file.filename)}"`,
        'content-length': String(file.bytes.byteLength),
        'x-content-type-options': 'nosniff',
      },
    });
  });
}

/** Archive, never delete (D-011). `{ isArchived: true }` is how a file is
 *  taken off the application. */
export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireUserId(request);
    const { id } = await params;
    const body = await parseJsonBody(request, patchApplicationFileSchema);
    return Response.json(await updateApplicationFile(userId, id, body));
  });
}
