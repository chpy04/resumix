/**
 * PDF snapshot adapter (docs/DECISIONS.md D-003). Everything that knows the
 * bytes live in the `resume_pdf` `bytea` column lives here; swapping to
 * Supabase Storage later should only touch this file — callers only ever
 * see `saveResumePdfSnapshot` / `getLatestResumePdfSnapshot`.
 */
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from './db/index.ts';
import { resumePdf } from './db/schema.ts';

export interface NewPdfSnapshot {
  filename: string;
  bytes: Buffer;
  tex: string;
}

export interface PdfSnapshotMeta {
  filename: string;
  createdAt: string;
}

export interface PdfSnapshot extends PdfSnapshotMeta {
  bytes: Buffer;
}

/** A freshly stored snapshot, which is the one case where the row's own id
 *  matters: an application pins itself to it (docs/SCHEMA.md, `application`). */
export interface SavedPdfSnapshot extends PdfSnapshotMeta {
  id: string;
}

/** Stores a new snapshot. History is kept — this never overwrites a prior row. */
export async function saveResumePdfSnapshot(
  resumeId: string,
  snapshot: NewPdfSnapshot,
): Promise<SavedPdfSnapshot> {
  const [row] = await db
    .insert(resumePdf)
    .values({
      resumeId,
      filename: snapshot.filename,
      bytes: snapshot.bytes,
      byteSize: snapshot.bytes.byteLength,
      tex: snapshot.tex,
    })
    .returning({
      id: resumePdf.id,
      filename: resumePdf.filename,
      createdAt: resumePdf.createdAt,
    });

  if (!row) {
    throw new Error('failed to store PDF snapshot');
  }
  return { id: row.id, filename: row.filename, createdAt: row.createdAt.toISOString() };
}

/**
 * One snapshot by its own id — how an application serves back the exact bytes
 * it was sent with, rather than whatever the resume looks like now.
 *
 * Snapshots carry no `user_id`; ownership comes from the row that referenced
 * this id, which the caller has already resolved against the session (see
 * `lib/queries/applications.ts`).
 */
export async function getResumePdfSnapshotById(id: string): Promise<PdfSnapshot | null> {
  const [row] = await db
    .select({
      filename: resumePdf.filename,
      bytes: resumePdf.bytes,
      createdAt: resumePdf.createdAt,
    })
    .from(resumePdf)
    .where(eq(resumePdf.id, id))
    .limit(1);

  if (!row) return null;
  return { filename: row.filename, bytes: row.bytes, createdAt: row.createdAt.toISOString() };
}

/** The most recently stored snapshot for a resume, or `null` if it has never been saved. */
export async function getLatestResumePdfSnapshot(resumeId: string): Promise<PdfSnapshot | null> {
  const [row] = await db
    .select({
      filename: resumePdf.filename,
      bytes: resumePdf.bytes,
      createdAt: resumePdf.createdAt,
    })
    .from(resumePdf)
    .where(eq(resumePdf.resumeId, resumeId))
    // The id breaks ties; two saves in one transaction would share a
    // created_at, and "latest" must never be a coin flip (D-030).
    .orderBy(desc(resumePdf.createdAt), desc(resumePdf.id))
    .limit(1);

  if (!row) return null;
  return { filename: row.filename, bytes: row.bytes, createdAt: row.createdAt.toISOString() };
}

/** Metadata only (no bytes) for the most recent snapshot of each resume in
 * one query — used to assemble `ResumeSummary.latestPdf` without N+1s.
 *
 * Snapshots carry no `user_id`; they belong to whoever owns the resume. The
 * `inArray` filter is what keeps this to the caller's own resumes, since
 * the ids passed in always come from a user-scoped resume query. */
export async function getLatestResumePdfMetaByResumeId(
  resumeIds: string[],
): Promise<Map<string, PdfSnapshotMeta>> {
  const result = new Map<string, PdfSnapshotMeta>();
  if (resumeIds.length === 0) return result;

  const rows = await db
    .selectDistinctOn([resumePdf.resumeId], {
      resumeId: resumePdf.resumeId,
      filename: resumePdf.filename,
      createdAt: resumePdf.createdAt,
    })
    .from(resumePdf)
    .where(inArray(resumePdf.resumeId, resumeIds))
    // Tie-broken on id, as above (D-030). DISTINCT ON takes the first row
    // per resume_id, so a tie here silently picks an arbitrary snapshot.
    .orderBy(resumePdf.resumeId, desc(resumePdf.createdAt), desc(resumePdf.id));

  for (const row of rows) {
    result.set(row.resumeId, { filename: row.filename, createdAt: row.createdAt.toISOString() });
  }
  return result;
}
