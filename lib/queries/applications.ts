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
 * from, and the immutable snapshot that was actually sent (D-032).
 */
import { and, desc, eq } from 'drizzle-orm';
import { nextAppliedAt, type ManualStatus } from '../applications/status.ts';
import { db } from '../db/index.ts';
import { application, coverLetter, resume, resumePdf } from '../db/schema.ts';
import type {
  ApplicationDetail,
  ApplicationFile,
  ApplicationSummary,
  Selections,
} from '../types.ts';
import { listApplicationFiles } from './application-files.ts';
import { createCoverLetter } from './cover-letters.ts';
import { BadRequestError, NotFoundError } from './errors.ts';
import { createResume, getDefaultResumeRow } from './resumes.ts';

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
  /** A flow status is never patched in by hand; the review flow writes
   *  those through its own query functions (D-041). */
  status?: ManualStatus;
  /** `null` unlinks the resume; omitted leaves it alone. */
  resumeId?: string | null;
  /** `null` unlinks the cover letter; the letter itself is untouched. */
  coverLetterId?: string | null;
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
    coverLetterId: row.coverLetterId,
    fitScore: row.fitScore,
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
  return {
    ...toSummary(row, sentPdf),
    notes: row.notes,
    jobDescription: row.jobDescription,
    agentSummary: row.agentSummary,
    files,
  };
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

/** Scoped exactly like `assertOwnedResume`: another user's cover letter id
 *  is a 400 that reads the same as a nonexistent one. */
async function assertOwnedCoverLetter(userId: string, coverLetterId: string): Promise<void> {
  const [row] = await db
    .select({ id: coverLetter.id })
    .from(coverLetter)
    .where(and(eq(coverLetter.id, coverLetterId), eq(coverLetter.userId, userId)))
    .limit(1);
  if (!row) throw new BadRequestError(`unknown cover letter id: ${coverLetterId}`);
}

/**
 * Logs an application, and — normally — gives it a resume of its own.
 *
 * `createResumeFrom` clones that resume under the company's name, which is
 * the front door: you see a posting, you log it, and you immediately have
 * something to tailor without touching the resume you started from.
 * `resumeId` instead links a resume that already exists. Passing neither
 * leaves the application without one, for logging something sent elsewhere.
 */
export async function createApplication(
  userId: string,
  input: {
    company: string;
    roleTitle?: string;
    postingUrl?: string;
    resumeId?: string | null;
    createResumeFrom?: string | null;
  },
): Promise<ApplicationDetail> {
  if (input.resumeId) await assertOwnedResume(userId, input.resumeId);

  // `createResume` re-checks ownership of the source and 400s on a stranger's.
  const created = input.createResumeFrom
    ? await createResume(userId, input.company, input.createResumeFrom)
    : null;

  const [row] = await db
    .insert(application)
    .values({
      userId,
      company: input.company,
      roleTitle: input.roleTitle ?? '',
      postingUrl: input.postingUrl ?? '',
      resumeId: created?.id ?? input.resumeId ?? null,
    })
    .returning();
  if (!row) throw new Error('failed to create application');

  return detailFor(row);
}

/**
 * The agent's front door (D-042): an application that arrives in
 * `proposing`, with the posting, the agent's evaluation and its score, and
 * a copy of Default named after the company to propose a resume in.
 *
 * Always Default, never another resume: the agent picks from the library,
 * and Default is the one every account has. `createResume` is the same clone
 * `createResumeFrom` takes.
 */
export async function createProposedApplication(
  userId: string,
  input: {
    company: string;
    roleTitle: string;
    postingUrl: string;
    jobDescription: string;
    agentSummary: string;
    fitScore: number;
  },
): Promise<ApplicationDetail> {
  const source = await getDefaultResumeRow(userId);
  // Every account is provisioned with one, so this is a broken account. Said
  // here, in words, because `createResume`'s own refusal is a plain `Error`,
  // which would reach the agent as an anonymous internal error.
  if (!source) {
    throw new BadRequestError(
      'This account has no Default resume to copy, so no application was created. ' +
        'Stop and tell Chris.',
    );
  }
  const created = await createResume(userId, input.company, source.id);

  const [row] = await db
    .insert(application)
    .values({
      userId,
      company: input.company,
      roleTitle: input.roleTitle,
      postingUrl: input.postingUrl,
      status: 'proposing',
      jobDescription: input.jobDescription,
      agentSummary: input.agentSummary,
      fitScore: input.fitScore,
      resumeId: created.id,
    })
    .returning();
  if (!row) throw new Error('failed to create application');

  return detailFor(row);
}

/**
 * Records the agent's pick as `proposed_selection` (C7), and only while the
 * application is still `proposing`: once it is in review, the pick it was
 * proposed with is the baseline "Reset to agent pick" returns to, and later
 * edits must not move it. The status test is in the WHERE clause, so a
 * review that starts mid-call cannot be overwritten. Each call while
 * proposing replaces the last. Returns whether a row was written.
 */
export async function setProposedSelection(
  userId: string,
  id: string,
  selections: Selections,
): Promise<boolean> {
  const rows = await db
    .update(application)
    .set({ proposedSelection: selections })
    .where(
      and(
        eq(application.id, id),
        eq(application.userId, userId),
        eq(application.status, 'proposing'),
      ),
    )
    .returning({ id: application.id });
  return rows.length > 0;
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
  if (patch.coverLetterId) await assertOwnedCoverLetter(userId, patch.coverLetterId);

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
 * Points an application at a PDF snapshot without touching its status.
 *
 * This is "save this resume to the application": you edit the resume from
 * inside the application, save, and the application now holds those bytes.
 * Doing it before it is sent is normal — marking it applied is a separate,
 * later decision.
 */
export async function pinResumePdf(
  userId: string,
  id: string,
  resumePdfId: string,
): Promise<ApplicationDetail> {
  const [row] = await db
    .update(application)
    .set({ resumePdfId })
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
 * Gives this application a cover letter of its own, copied from the user's
 * default and named after the company.
 *
 * The resume equivalent happens at creation time (`createResumeFrom`),
 * because an application always arrives with a resume to tailor. A cover
 * letter is a later, optional decision — plenty of postings never ask for
 * one — so it is its own action rather than a field on the create form.
 *
 * Replacing an existing link leaves the old letter in place, unarchived and
 * still in the library. Nothing here destroys a document.
 */
export async function attachCoverLetter(userId: string, id: string): Promise<ApplicationDetail> {
  const existing = await getApplicationRow(userId, id);
  if (!existing) throw new NotFoundError(`application ${id} not found`);

  const created = await createCoverLetter(userId, existing.company);

  const [row] = await db
    .update(application)
    .set({ coverLetterId: created.id })
    .where(and(eq(application.id, id), eq(application.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`application ${id} not found`);

  return detailFor(row);
}
