import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { resume } from '../db/schema.ts';
import type { ResumeDetail, ResumeSummary } from '../types.ts';
import { getLatestResumePdfMetaByResumeId } from '../storage.ts';
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
export async function listResumeSummaries(): Promise<ResumeSummary[]> {
  const rows = await db
    .select()
    .from(resume)
    .orderBy(desc(resume.isDefault), desc(resume.createdAt));

  const pdfMeta = await getLatestResumePdfMetaByResumeId(rows.map((r) => r.id));

  return rows.map((row) => toSummary(row, pdfMeta.get(row.id) ?? null));
}

export async function getResumeRow(id: string): Promise<ResumeRow | null> {
  const [row] = await db.select().from(resume).where(eq(resume.id, id)).limit(1);
  return row ?? null;
}

export async function getResumeSummary(id: string): Promise<ResumeSummary | null> {
  const row = await getResumeRow(id);
  if (!row) return null;
  const pdfMeta = await getLatestResumePdfMetaByResumeId([id]);
  return toSummary(row, pdfMeta.get(id) ?? null);
}

async function getDefaultResumeRow(): Promise<ResumeRow | null> {
  const [row] = await db.select().from(resume).where(eq(resume.isDefault, true)).limit(1);
  return row ?? null;
}

/** Clones the default resume's template + every selection slice, per docs/API.md. */
export async function createResume(name: string): Promise<ResumeSummary> {
  const defaultResume = await getDefaultResumeRow();
  if (!defaultResume) {
    throw new Error('no default resume is configured — cannot clone');
  }

  const [row] = await db
    .insert(resume)
    .values({ name, isDefault: false, templateId: defaultResume.templateId })
    .returning();
  if (!row) throw new Error('failed to create resume');

  await cloneSelections(defaultResume.id, row.id);

  return toSummary(row, null);
}

export async function updateResume(
  id: string,
  patch: { name?: string; templateId?: string },
): Promise<ResumeSummary> {
  if (patch.templateId !== undefined) {
    const template = await getTemplateById(patch.templateId);
    if (!template) {
      throw new BadRequestError(`unknown template id: ${patch.templateId}`);
    }
  }

  const [row] = await db.update(resume).set(patch).where(eq(resume.id, id)).returning();
  if (!row) throw new NotFoundError(`resume ${id} not found`);

  const pdfMeta = await getLatestResumePdfMetaByResumeId([id]);
  return toSummary(row, pdfMeta.get(id) ?? null);
}

/** 400s on the default resume — see docs/DECISIONS.md D-011/D-012 and docs/API.md. */
export async function deleteResume(id: string): Promise<void> {
  const row = await getResumeRow(id);
  if (!row) throw new NotFoundError(`resume ${id} not found`);
  if (row.isDefault) {
    throw new BadRequestError('cannot delete the default resume');
  }
  await db.delete(resume).where(eq(resume.id, id));
}

/** The whole editor payload in one round trip (D-012). Library always
 * includes archived content — the editor UI is responsible for filtering it. */
export async function getResumeDetail(id: string): Promise<ResumeDetail | null> {
  const row = await getResumeRow(id);
  if (!row) return null;

  const template = await getTemplateById(row.templateId);
  if (!template) {
    throw new Error(`resume ${id} references missing template ${row.templateId}`);
  }

  const [selections, library, pdfMeta] = await Promise.all([
    getSelections(id),
    assembleLibrary(true),
    getLatestResumePdfMetaByResumeId([id]),
  ]);

  return {
    resume: toSummary(row, pdfMeta.get(id) ?? null),
    template,
    selections,
    library,
  };
}
