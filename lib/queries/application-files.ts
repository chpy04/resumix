/**
 * Attachments on an application: a cover letter, a take-home, a screenshot of
 * the posting, an offer letter. Untyped on purpose — see D-031.
 *
 * An `application_file` has no `user_id` of its own; it belongs to whoever
 * owns its application (docs/SCHEMA.md), so every function here resolves that
 * through a join rather than trusting the caller.
 *
 * This is the second place in the codebase that knows blobs live in a `bytea`
 * column — `lib/storage.ts` is the first, for PDF snapshots (D-003). If those
 * ever move to object storage, both move.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { application, applicationFile } from '../db/schema.ts';
import type { ApplicationFile } from '../types.ts';
import { NotFoundError } from './errors.ts';

/** Columns that are safe to select for metadata: everything but the bytes. */
const metaColumns = {
  id: applicationFile.id,
  filename: applicationFile.filename,
  contentType: applicationFile.contentType,
  byteSize: applicationFile.byteSize,
  isArchived: applicationFile.isArchived,
  createdAt: applicationFile.createdAt,
};

interface MetaRow {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  isArchived: boolean;
  createdAt: Date;
}

function toWire(row: MetaRow): ApplicationFile {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    byteSize: row.byteSize,
    isArchived: row.isArchived,
    createdAt: row.createdAt.toISOString(),
  };
}

async function assertOwnedFile(userId: string, fileId: string): Promise<void> {
  const [row] = await db
    .select({ id: applicationFile.id })
    .from(applicationFile)
    .innerJoin(application, eq(applicationFile.applicationId, application.id))
    .where(and(eq(applicationFile.id, fileId), eq(application.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError(`application file ${fileId} not found`);
}

export async function listApplicationFiles(
  userId: string,
  applicationId: string,
): Promise<ApplicationFile[]> {
  const rows = await db
    .select(metaColumns)
    .from(applicationFile)
    .innerJoin(application, eq(applicationFile.applicationId, application.id))
    .where(and(eq(applicationFile.applicationId, applicationId), eq(application.userId, userId)))
    // The id breaks the tie; created_at is not unique (D-030).
    .orderBy(desc(applicationFile.createdAt), desc(applicationFile.id));
  return rows.map(toWire);
}

export async function addApplicationFile(
  userId: string,
  applicationId: string,
  file: { filename: string; contentType: string; bytes: Buffer },
): Promise<ApplicationFile> {
  const [parent] = await db
    .select({ id: application.id })
    .from(application)
    .where(and(eq(application.id, applicationId), eq(application.userId, userId)))
    .limit(1);
  if (!parent) throw new NotFoundError(`application ${applicationId} not found`);

  const [row] = await db
    .insert(applicationFile)
    .values({
      applicationId,
      filename: file.filename,
      contentType: file.contentType,
      bytes: file.bytes,
      byteSize: file.bytes.byteLength,
    })
    .returning(metaColumns);
  if (!row) throw new Error('failed to store application file');
  return toWire(row);
}

/** The only path that reads the bytes back out. */
export async function getApplicationFileBlob(
  userId: string,
  fileId: string,
): Promise<{ filename: string; contentType: string; bytes: Buffer } | null> {
  const [row] = await db
    .select({
      filename: applicationFile.filename,
      contentType: applicationFile.contentType,
      bytes: applicationFile.bytes,
    })
    .from(applicationFile)
    .innerJoin(application, eq(applicationFile.applicationId, application.id))
    .where(and(eq(applicationFile.id, fileId), eq(application.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Archive, never delete (D-011) — an attachment is hidden, not destroyed. */
export async function updateApplicationFile(
  userId: string,
  fileId: string,
  patch: { isArchived: boolean },
): Promise<ApplicationFile> {
  await assertOwnedFile(userId, fileId);

  const [row] = await db
    .update(applicationFile)
    .set(patch)
    .where(eq(applicationFile.id, fileId))
    .returning(metaColumns);
  if (!row) throw new NotFoundError(`application file ${fileId} not found`);
  return toWire(row);
}
