/**
 * The agent's file downloads: `GET /api/mcp/files/<kind>/<id>`, behind the
 * same `rmx_` token as `/api/mcp` (C5, D-050). A tool hands the agent a
 * file as one of these paths, never as bytes in a result. Plain Web
 * `Response`, like `http.ts`, so it runs under `node --test` without Next.
 *
 * Strict on purpose: a file is served only while it is in a live Ready
 * application's apply packet, which is the pinned resume PDF, the pinned
 * letter PDF, archived or not, and the attachments its `file` questions
 * picked. The token sits with an agent that reads untrusted pages, so it
 * can fetch only what Chris approved to send, and a path stops working once
 * the application is reopened or sent. Every miss is the same 404, whoever's
 * the file is.
 */
import { z } from 'zod';
import { sanitizeAttachmentFilename, servableContentType } from '../applications/attachments.ts';
import { packetHasFile, type ApplyFileKind } from '../applications/apply-packet.ts';
import { loadApplyPacket } from '../apply-packet.ts';
import { sanitizeForHeader } from '../filename.ts';
import { getApplicationFileBlob } from '../queries/application-files.ts';
import { findReadyApplicationPinning } from '../queries/applications.ts';
import { getResumePdfSnapshotById } from '../storage.ts';

const fileId = z.uuid();

function notFound(id: string): Response {
  return Response.json({ error: `file ${id} not found` }, { status: 404 });
}

interface Served {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

/** The file, or null when it is not one this caller may fetch. */
async function findServable(
  userId: string,
  kind: ApplyFileKind,
  id: string,
): Promise<Served | null> {
  // Anything else would reach Postgres as an invalid uuid, a 500.
  if (!fileId.safeParse(id).success) return null;

  const blob = kind === 'application-file' ? await getApplicationFileBlob(userId, id) : null;
  // An archived file may still be the pinned letter; the packet decides.
  const applicationId =
    kind === 'resume-pdf' ? await findReadyApplicationPinning(userId, id) : blob?.applicationId;
  if (!applicationId) return null;

  // Rebuilt, not trusted: a file is served only while the packet names it.
  const loaded = await loadApplyPacket(userId, applicationId);
  if (!loaded?.ok || !packetHasFile(loaded.packet, { kind, id })) return null;

  if (blob) {
    return {
      filename: sanitizeAttachmentFilename(blob.filename),
      contentType: servableContentType(blob.contentType),
      bytes: blob.bytes,
    };
  }
  // A snapshot has no owner of its own; the Ready application above is it.
  const snapshot = await getResumePdfSnapshotById(id);
  if (!snapshot) return null;
  return {
    filename: sanitizeForHeader(snapshot.filename),
    contentType: 'application/pdf',
    bytes: snapshot.bytes,
  };
}

/**
 * One packet file's bytes, as a download. Called by the two routes under
 * `app/api/mcp/files/`, after `requireMcpUserId`. The headers are the
 * attachment route's (`GET /api/application-files/:id`), plus `no-store`:
 * these are the approved documents, and no cache between here and the agent
 * should keep a copy.
 */
export async function serveApplyFile(
  userId: string,
  kind: ApplyFileKind,
  id: string,
): Promise<Response> {
  const file = await findServable(userId, kind, id);
  if (!file) return notFound(id);

  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.filename}"`,
      'content-length': String(file.bytes.byteLength),
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}
