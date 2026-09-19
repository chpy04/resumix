/**
 * Applications, always scoped to their owner.
 *
 * Same contract as every other query module: the caller's `userId` is the
 * first argument and every statement filters on it, so an application id
 * belonging to someone else reads as "not found" rather than "forbidden"
 * (docs/API.md).
 *
 * An application stores no resume text and no PDF bytes of its own. It holds
 * two nullable references instead — the live resume it is being tailored
 * from, and the immutable snapshot that was actually sent (D-031).
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { nextAppliedAt } from '../applications/status.ts';
import { db } from '../db/index.ts';
import { application, resume, resumePdf } from '../db/schema.ts';
import type {
  ApplicationDetail,
  ApplicationFile,
  ApplicationStatus,
  ApplicationSummary,
} from '../types.ts';
import { listApplicationFiles } from './application-files.ts';
import { BadRequestError, NotFoundError } from './errors.ts';

type ApplicationRow = typeof application.$inferSelect;

/** What the `resume_pdf` left join contributes — never the bytes. */
interface SentPdfMeta {
  filename: string;
  createdAt: string;
}

export interface ApplicationPatch {
  company?: string;
  roleTitle?: string;
  postingUrl?: string;
  notes?: string;
  status?: ApplicationStatus;
  /** `null` unlinks the resume; omitted leaves it alone. */
  resumeId?: string | null;
  isArchived?: boolean;
}

function toSummary(row: ApplicationRow, sentPdf: SentPdfMeta | null): ApplicationSummary {
  return {
    id: row.id,
    company: row.company,
    roleTitle: row.roleTitle,
    postingUrl: row.postingUrl,
    status: row.status,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    resumeId: row.resumeId,
    sentPdf,
    isArchived: row.isArchived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(
  row: ApplicationRow,
  sentPdf: SentPdfMeta | null,
  files: ApplicationFile[],
): ApplicationDetail {
  return { ...toSummary(row, sentPdf), notes: row.notes, files };
}

/** Newest first. The board regroups and re-sorts client-side
 *  (`lib/applications/board.ts`); this order is what a bare list gets. */
export async function listApplications(
  userId: string,
  includeArchived: boolean,
): Promise<ApplicationSummary[]> {
  const rows = await db
    .select({
      application,
      pdfFilename: resumePdf.filename,
      pdfCreatedAt: resumePdf.createdAt,
    })
    .from(application)
    .leftJoin(resumePdf, eq(application.resumePdfId, resumePdf.id))
    .where(
      includeArchived
        ? eq(application.userId, userId)
        : and(eq(application.userId, userId), eq(application.isArchived, false)),
    )
    // The id breaks the tie; created_at is not unique (D-030).
    .orderBy(desc(application.createdAt), desc(application.id));

  return rows.map((row) =>
    toSummary(
      row.application,
      row.pdfFilename && row.pdfCreatedAt
        ? { filename: row.pdfFilename, createdAt: row.pdfCreatedAt.toISOString() }
        : null,
    ),
  );
}

export async function getApplicationRow(
  userId: string,
  id: string,
): Promise<ApplicationRow | null> {
  const [row] = await db
    .select()
    .from(application)
    .where(and(eq(application.id, id), eq(application.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function sentPdfMeta(resumePdfId: string | null): Promise<SentPdfMeta | null> {
  if (!resumePdfId) return null;
  const [row] = await db
    .select({ filename: resumePdf.filename, createdAt: resumePdf.createdAt })
    .from(resumePdf)
    .where(eq(resumePdf.id, resumePdfId))
    .limit(1);
  return row ? { filename: row.filename, createdAt: row.createdAt.toISOString() } : null;
}

async function detailFor(row: ApplicationRow): Promise<ApplicationDetail> {
  const [sentPdf, files] = await Promise.all([
    sentPdfMeta(row.resumePdfId),
    listApplicationFiles(row.userId, row.id),
  ]);
  return toDetail(row, sentPdf, files);
}

export async function getApplicationDetail(
  userId: string,
  id: string,
): Promise<ApplicationDetail | null> {
  const row = await getApplicationRow(userId, id);
  if (!row) return null;
  return detailFor(row);
}

/** Scoped lookup: linking another user's resume is a 400, exactly like
 *  linking a resume id that does not exist. */
async function assertOwnedResume(userId: string, resumeId: string): Promise<void> {
  const [row] = await db
    .select({ id: resume.id })
    .from(resume)
    .where(and(eq(resume.id, resumeId), eq(resume.userId, userId)))
    .limit(1);
  if (!row) throw new BadRequestError(`unknown resume id: ${resumeId}`);
}

export async function createApplication(
  userId: string,
  input: { company: string; roleTitle?: string; postingUrl?: string; resumeId?: string | null },
): Promise<ApplicationDetail> {
  if (input.resumeId) await assertOwnedResume(userId, input.resumeId);

  const [row] = await db
    .insert(application)
    .values({
      userId,
      company: input.company,
      roleTitle: input.roleTitle ?? '',
      postingUrl: input.postingUrl ?? '',
      resumeId: input.resumeId ?? null,
    })
    .returning();
  if (!row) throw new Error('failed to create application');

  return detailFor(row);
}

/**
 * Field edits, the status picker and archiving all land here.
 *
 * `applied_at` is not a field the caller can set: it follows from the status
 * per `nextAppliedAt`, so the date something was sent cannot drift from
 * whether it was sent.
 */
export async function updateApplication(
  userId: string,
  id: string,
  patch: ApplicationPatch,
): Promise<ApplicationDetail> {
  const existing = await getApplicationRow(userId, id);
  if (!existing) throw new NotFoundError(`application ${id} not found`);

  if (patch.resumeId) await assertOwnedResume(userId, patch.resumeId);

  const { status, ...rest } = patch;
  const [row] = await db
    .update(application)
    .set({
      ...rest,
      ...(status === undefined
        ? {}
        : { status, appliedAt: nextAppliedAt(existing.appliedAt, status, new Date()) }),
    })
    .where(and(eq(application.id, id), eq(application.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`application ${id} not found`);

  return detailFor(row);
}

/**
 * Marks an application as sent, pinning it to the snapshot that went out.
 *
 * `resumePdfId` is null when there is no resume linked — you can log an
 * application you sent from somewhere else entirely, it just has no bytes to
 * show for it. Called by `POST /api/applications/:id/apply` once the render
 * has actually produced a PDF; the compile itself lives in the route, as it
 * does for `POST /api/resumes/:id/pdf`.
 */
export async function recordApplied(
  userId: string,
  id: string,
  resumePdfId: string | null,
): Promise<ApplicationDetail> {
  const existing = await getApplicationRow(userId, id);
  if (!existing) throw new NotFoundError(`application ${id} not found`);

  const [row] = await db
    .update(application)
    .set({
      status: 'applied',
      appliedAt: nextAppliedAt(existing.appliedAt, 'applied', new Date()),
      // A re-send replaces the snapshot; not sending one leaves the last in place.
      ...(resumePdfId === null ? {} : { resumePdfId }),
    })
    .where(and(eq(application.id, id), eq(application.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`application ${id} not found`);

  return detailFor(row);
}

/**
 * How many of this user's applications were sent with a snapshot of this
 * resume. `deleteResume` asks before deleting: `resume_pdf` cascades from
 * `resume`, and an application's snapshot is the only record of what was
 * actually sent, so the delete gives way to it (D-031).
 */
export async function countApplicationsSentWithResume(
  userId: string,
  resumeId: string,
): Promise<number> {
  const rows = await db
    .select({ id: application.id })
    .from(application)
    .innerJoin(resumePdf, eq(application.resumePdfId, resumePdf.id))
    .where(
      and(
        eq(application.userId, userId),
        eq(resumePdf.resumeId, resumeId),
        isNotNull(application.resumePdfId),
      ),
    );
  return rows.length;
}
