/**
 * Resumes, always scoped to their owner.
 *
 * Every function takes the caller's `userId` and filters by it, so a resume
 * id belonging to someone else behaves exactly like one that does not
 * exist — `null` / `NotFoundError`, never a 403. Distinguishing the two
 * would confirm to a stranger that a given id is real.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { resume } from '../db/schema.ts';
import type { ResumeDetail, ResumeSummary } from '../types.ts';
import { getLatestResumePdfMetaByResumeId } from '../storage.ts';
import { countApplicationsSentWithResume } from './applications.ts';
import { BadRequestError, NotFoundError } from './errors.ts';
import { assembleLibrary } from './library.ts';
import { cloneSelections, getSelections } from './selections.ts';
import { getTemplateById } from './templates.ts';

type ResumeRow = typeof resume.$inferSelect;

function toSummary(
  row: ResumeRow,
  latestPdf: { filename: string; createdAt: string } | null,
): ResumeSummary {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    templateId: row.templateId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    latestPdf,
  };
}

/** Default first, then `created_at desc`, per docs/API.md. */
export async function listResumeSummaries(userId: string): Promise<ResumeSummary[]> {
  const rows = await db
    .select()
    .from(resume)
    .where(eq(resume.userId, userId))
    // The id breaks ties; the first column is not unique (D-030).
    .orderBy(desc(resume.isDefault), desc(resume.createdAt), desc(resume.id));

  const pdfMeta = await getLatestResumePdfMetaByResumeId(rows.map((r) => r.id));

  return rows.map((row) => toSummary(row, pdfMeta.get(row.id) ?? null));
}

export async function getResumeRow(userId: string, id: string): Promise<ResumeRow | null> {
  const [row] = await db
    .select()
    .from(resume)
    .where(and(eq(resume.id, id), eq(resume.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getResumeSummary(userId: string, id: string): Promise<ResumeSummary | null> {
  const row = await getResumeRow(userId, id);
  if (!row) return null;
  const pdfMeta = await getLatestResumePdfMetaByResumeId([id]);
  return toSummary(row, pdfMeta.get(id) ?? null);
}

async function getDefaultResumeRow(userId: string): Promise<ResumeRow | null> {
  const [row] = await db
    .select()
    .from(resume)
    .where(and(eq(resume.userId, userId), eq(resume.isDefault, true)))
    .limit(1);
  return row ?? null;
}

/** Clones *this user's* default resume — its template + every selection
 *  slice, per docs/API.md. Every user has one, created by `provisionUser`. */
export async function createResume(userId: string, name: string): Promise<ResumeSummary> {
  const defaultResume = await getDefaultResumeRow(userId);
  if (!defaultResume) {
    throw new Error('no default resume is configured — cannot clone');
  }

  const [row] = await db
    .insert(resume)
    .values({ name, isDefault: false, templateId: defaultResume.templateId, userId })
    .returning();
  if (!row) throw new Error('failed to create resume');

  await cloneSelections(userId, defaultResume.id, row.id);

  return toSummary(row, null);
}

export async function updateResume(
  userId: string,
  id: string,
  patch: { name?: string; templateId?: string },
): Promise<ResumeSummary> {
  if (patch.templateId !== undefined) {
    // Scoped lookup: pointing a resume at another user's template is a 400,
    // exactly like pointing it at a template id that does not exist.
    const template = await getTemplateById(userId, patch.templateId);
    if (!template) {
      throw new BadRequestError(`unknown template id: ${patch.templateId}`);
    }
  }

  const [row] = await db
    .update(resume)
    .set(patch)
    .where(and(eq(resume.id, id), eq(resume.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`resume ${id} not found`);

  const pdfMeta = await getLatestResumePdfMetaByResumeId([id]);
  return toSummary(row, pdfMeta.get(id) ?? null);
}

/** 400s on the default resume — see docs/DECISIONS.md D-011/D-012 and docs/API.md. */
export async function deleteResume(userId: string, id: string): Promise<void> {
  const row = await getResumeRow(userId, id);
  if (!row) throw new NotFoundError(`resume ${id} not found`);
  if (row.isDefault) {
    throw new BadRequestError('cannot delete the default resume');
  }

  // `resume_pdf` cascades from `resume`, so deleting this would take the
  // snapshots with it — including one an application points at as the record
  // of what it actually sent. That record wins (D-031). Checked here rather
  // than left to the foreign key so the caller gets a 400 that says why,
  // instead of a 500 out of Postgres.
  const sentCount = await countApplicationsSentWithResume(userId, id);
  if (sentCount > 0) {
    throw new BadRequestError(
      `cannot delete a resume that ${sentCount} application(s) were sent with`,
    );
  }
  await db.delete(resume).where(and(eq(resume.id, id), eq(resume.userId, userId)));
}

/** The whole editor payload in one round trip (D-012). Library always
 * includes archived content — the editor UI is responsible for filtering it. */
export async function getResumeDetail(userId: string, id: string): Promise<ResumeDetail | null> {
  const row = await getResumeRow(userId, id);
  if (!row) return null;

  const template = await getTemplateById(userId, row.templateId);
  if (!template) {
    throw new Error(`resume ${id} references missing template ${row.templateId}`);
  }

  const [selections, library, pdfMeta] = await Promise.all([
    getSelections(id),
    assembleLibrary(userId, true),
    getLatestResumePdfMetaByResumeId([id]),
  ]);

  return {
    resume: toSummary(row, pdfMeta.get(id) ?? null),
    template,
    selections,
    library,
  };
}
