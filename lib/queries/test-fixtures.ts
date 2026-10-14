/**
 * Shared setup for the `lib/queries/*.test.ts` integration suites. These run
 * against a real Postgres (`DATABASE_URL`, e.g. the docker-compose `db`
 * service) — never mocked. Every test file marks itself `{ skip: ... }` when
 * `DATABASE_URL` is unset so `npm test` still passes without a database.
 *
 * The DB is shared dev infrastructure (other worktrees/tasks may be seeding
 * it concurrently), so fixtures here never assume the DB is empty and never
 * touch rows they didn't create themselves. Content rows are never deleted
 * (D-011) — tests that create experiences/projects/skill rows leave them
 * behind, tagged with a random suffix so they're easy to spot. Resumes
 * *are* cleaned up (DELETE is allowed for non-default resumes).
 *
 * Since T14 every content row needs an owner, so each fixture takes a
 * `userId`. Most tests use `seedUserId()` — the user `npm run db:seed`
 * creates — while isolation tests call `insertUser()` for a second,
 * fully-provisioned account to test *against*.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, sql, type Executor } from '../db/index.ts';
import {
  apiToken,
  application,
  applicationFile,
  applicationQuestion,
  coverLetter,
  experience,
  experienceBullet,
  project,
  projectBullet,
  resume,
  resumePdf,
  savedAnswer,
  technicalSkill,
  technicalSkillRow,
  users,
} from '../db/schema.ts';
import { approveApplication } from '../application-approval.ts';
import type { User } from '../types.ts';
import { createCoverLetter } from './cover-letters.ts';
import { provisionUser } from './users.ts';

export const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Unique-ish tag so fixture rows are identifiable in a shared dev database. */
export function testTag(): string {
  return randomUUID().slice(0, 8);
}

/** The seeded user — the same one `dev` auth mode logs in as. Most tests run
 *  as this user because the seeded Default resume belongs to them. */
export async function seedUserId(): Promise<string> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);
  if (!row) throw new Error('no users seeded — run `npm run db:seed` first');
  return row.id;
}

/** A second, fully-provisioned account (its own default template + Default
 *  resume), for proving that one user cannot reach another's data. */
export async function insertUser(tag: string): Promise<User> {
  return provisionUser({ email: `t14-${tag}@example.test`, name: `Test User ${tag}` });
}

export async function insertExperience(
  userId: string,
  tag: string,
  overrides: Partial<{ isArchived: boolean }> = {},
) {
  const [row] = await db
    .insert(experience)
    .values({
      company: `T6 Test Co ${tag}`,
      title: 'Test Engineer',
      dateRange: '2020 - 2021',
      location: 'Remote',
      isArchived: overrides.isArchived ?? false,
      userId,
    })
    .returning();
  if (!row) throw new Error('failed to insert test experience');
  return row;
}

/** `createdAt` is settable so a test can reproduce the shared-timestamp case
 *  the seed produces — `now()` is transaction-start time, so every row written
 *  in one transaction ties (D-030). Left to the column default otherwise. */
export async function insertExperienceBullet(
  experienceId: string,
  content: string,
  isArchived = false,
  createdAt?: Date,
) {
  const [row] = await db
    .insert(experienceBullet)
    .values({ experienceId, content, isArchived, ...(createdAt ? { createdAt } : {}) })
    .returning();
  if (!row) throw new Error('failed to insert test experience bullet');
  return row;
}

export async function insertProject(userId: string, tag: string) {
  const [row] = await db
    .insert(project)
    .values({
      name: `T6 Test Project ${tag}`,
      technologies: 'TypeScript',
      dateRange: '2022',
      userId,
    })
    .returning();
  if (!row) throw new Error('failed to insert test project');
  return row;
}

export async function insertProjectBullet(projectId: string, content: string) {
  const [row] = await db.insert(projectBullet).values({ projectId, content }).returning();
  if (!row) throw new Error('failed to insert test project bullet');
  return row;
}

export async function insertSkillRow(userId: string, tag: string) {
  const [row] = await db
    .insert(technicalSkillRow)
    .values({ name: `T6 Test Skills ${tag}`, top: true, userId })
    .returning();
  if (!row) throw new Error('failed to insert test skill row');
  return row;
}

export async function insertSkill(technicalSkillRowId: string, name: string) {
  const [row] = await db.insert(technicalSkill).values({ technicalSkillRowId, name }).returning();
  if (!row) throw new Error('failed to insert test skill');
  return row;
}

export async function getDefaultResumeRow(userId: string) {
  const [row] = await db
    .select()
    .from(resume)
    .where(and(eq(resume.userId, userId), eq(resume.isDefault, true)))
    .limit(1);
  if (!row)
    throw new Error('no default resume/template seeded — run scripts/migrate.ts and seed one');
  return row;
}

/** Inserts a throwaway (non-default) resume against that user's default template. */
export async function insertTestResume(userId: string, tag: string) {
  const defaultResume = await getDefaultResumeRow(userId);
  const [row] = await db
    .insert(resume)
    .values({ name: `T6 Test Resume ${tag}`, templateId: defaultResume.templateId, userId })
    .returning();
  if (!row) throw new Error('failed to insert test resume');
  return row;
}

export async function deleteResumeRow(id: string): Promise<void> {
  await db.delete(resume).where(eq(resume.id, id));
}

/** Applications are archived rather than deleted in the app, but they are
 *  visible on the board, so tests clean up after themselves like resumes do
 *  rather than filling a shared dev database with fixtures. Delete these
 *  *before* any resume they were sent with: the snapshot reference is
 *  `on delete restrict` on purpose.
 *
 *  `overrides` writes straight to the row, which is the only way to put an
 *  application into a flow status or give it the agent's fields: the API
 *  refuses both (D-041). */
export async function insertTestApplication(
  userId: string,
  tag: string,
  overrides: Partial<typeof application.$inferInsert> = {},
) {
  const [row] = await db
    .insert(application)
    .values({ userId, company: `T-App Test Co ${tag}`, roleTitle: 'Test Engineer', ...overrides })
    .returning();
  if (!row) throw new Error('failed to insert test application');
  return row;
}

export async function deleteApplicationRow(id: string): Promise<void> {
  await db.delete(application).where(eq(application.id, id));
}

/**
 * A question written straight to the row: an optional text question on page
 * 0 with a label unique to this call, unless `overrides` says otherwise. The
 * only way to reach a state the query layer refuses to write, which is what
 * the CHECK tests need. Deleting the application cascades to it.
 */
export async function insertTestQuestion(
  applicationId: string,
  overrides: Partial<typeof applicationQuestion.$inferInsert> = {},
) {
  const [row] = await db
    .insert(applicationQuestion)
    .values({
      applicationId,
      sortOrder: 0,
      prompt: 'Why us?',
      kind: 'text',
      fieldRef: { page: 0, label: `Why us? ${testTag()}`, selector: null },
      required: false,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('failed to insert test question');
  return row;
}

/** The raw row, answer encoding and all. */
export async function getQuestionRow(id: string) {
  const [row] = await db
    .select()
    .from(applicationQuestion)
    .where(eq(applicationQuestion.id, id))
    .limit(1);
  if (!row) throw new Error(`no application_question row ${id}`);
  return row;
}

/**
 * A saved answer written straight to the row: a text answer unless
 * `overrides` says otherwise. The only way to reach a state the query layer
 * refuses to write, which the CHECK tests need, and the way to give a test
 * one to link without going through a question. Left behind, like content
 * rows: saved answers are archived, never deleted (D-048).
 */
export async function insertSavedAnswer(
  userId: string,
  overrides: Partial<typeof savedAnswer.$inferInsert> = {},
) {
  const [row] = await db
    .insert(savedAnswer)
    .values({
      userId,
      prompt: 'How did you hear about us?',
      kind: 'text',
      answer: 'A friend.',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('failed to insert test saved answer');
  return row;
}

/** The raw row, archived or not, answer encoding and all. */
export async function getSavedAnswerRow(id: string) {
  const [row] = await db.select().from(savedAnswer).where(eq(savedAnswer.id, id)).limit(1);
  if (!row) throw new Error(`no saved_answer row ${id}`);
  return row;
}

/** Every saved answer a user has, archived ones included, oldest first. */
export async function listSavedAnswerRows(userId: string) {
  return db
    .select()
    .from(savedAnswer)
    .where(eq(savedAnswer.userId, userId))
    .orderBy(asc(savedAnswer.createdAt), asc(savedAnswer.id));
}

/** Cover letters are archived rather than deleted in the app, but like
 *  resumes they show up in a library the developer has to look at, so
 *  fixtures clean up after themselves. Never pass the provisioned Default. */
export async function deleteCoverLetterRow(id: string): Promise<void> {
  await db.delete(coverLetter).where(eq(coverLetter.id, id));
}

/** The raw `api_token` row, hash and all — what the wire type deliberately
 *  hides, and so the only way to prove what was actually stored. */
export async function getApiTokenRow(id: string) {
  const [row] = await db.select().from(apiToken).where(eq(apiToken.id, id)).limit(1);
  if (!row) throw new Error(`no api_token row ${id}`);
  return row;
}

/** What `stubLatex` answers for one `.tex`: a page count, a LaTeX error
 *  (`STUB_LATEX_ERROR`, or the errors given), or a sidecar that cannot be
 *  reached. */
export type StubbedCompile = number | 'error' | { errors: string[] } | 'down';

/** The error the stub reports for `'error'`, so a test can look for it. */
export const STUB_LATEX_ERROR = '! Undefined control sequence. l.7 \\nosuchmacro';

/**
 * Points `compileTex` at a fake sidecar, the way `lib/feedback/github.test.ts`
 * stubs GitHub: CI's test job has no sidecar, and the page count is usually
 * the thing under test. `pagesFor` decides each answer from the `.tex` it
 * was sent, so a test can tell a resume from a letter. Every `.tex` is
 * recorded. Call `restore()` in a `finally`.
 */
export function stubLatex(pagesFor: (tex: string) => StubbedCompile): {
  sent: string[];
  restore: () => void;
} {
  const sent: string[] = [];
  const original = { fetch: globalThis.fetch, url: process.env.LATEX_SERVICE_URL };
  process.env.LATEX_SERVICE_URL = 'http://latex.test';

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    // Anything else is a call this stub was never meant to answer.
    if (String(input) !== 'http://latex.test/compile') {
      throw new Error(`stubLatex: unexpected fetch of ${String(input)}`);
    }
    const { tex } = JSON.parse(String(init.body)) as { tex: string };
    sent.push(tex);
    const answer = pagesFor(tex);
    // What a real `fetch` throws when nothing is listening.
    if (answer === 'down') throw new TypeError('fetch failed');
    if (answer === 'error' || typeof answer === 'object') {
      return Response.json({
        ok: false,
        pages: null,
        errors: answer === 'error' ? [STUB_LATEX_ERROR] : answer.errors,
        log: '',
        durationMs: 1,
      });
    }
    // "%PDF-1.5": the bytes are never parsed, only stored and compared.
    return Response.json({
      ok: true,
      pdfBase64: 'JVBERi0xLjUK',
      pages: answer,
      errors: [],
      log: '',
      durationMs: 1,
    });
  }) as typeof fetch;

  return {
    sent,
    restore: () => {
      globalThis.fetch = original.fetch;
      if (original.url === undefined) delete process.env.LATEX_SERVICE_URL;
      else process.env.LATEX_SERVICE_URL = original.url;
    },
  };
}

/**
 * An application made Ready the real way, so its pinned PDF and its letter's
 * PDF are exactly what final approval stores (C4): in Needs review with its
 * sections approved, then `approveApplication`, with the sidecar stubbed for
 * that call only. It has a letter copied from Default unless `withLetter`
 * is false. `beforeApproval` adds questions and attachments while it is
 * still in review. `cleanup()` deletes what this made, in the order the
 * snapshot's `restrict` reference needs.
 */
export async function insertReadyApplication(
  userId: string,
  tag: string,
  options: {
    withLetter?: boolean;
    beforeApproval?: (applicationId: string) => Promise<void>;
  } = {},
) {
  const resume = await insertTestResume(userId, tag);
  const company = `T-Ready Co ${tag}`;
  const letter = options.withLetter === false ? null : await createCoverLetter(userId, company);
  const app = await insertTestApplication(userId, tag, {
    company,
    status: 'needs_review',
    resumeId: resume.id,
    coverLetterId: letter?.id ?? null,
    resumeApprovedAt: new Date(),
    coverLetterApprovedAt: letter ? new Date() : null,
  });
  await options.beforeApproval?.(app.id);

  const latex = stubLatex(() => 1);
  try {
    const approved = await approveApplication(userId, app.id);
    if (!approved.ok) throw new Error(`approval failed: ${approved.errors.join('; ')}`);
  } finally {
    latex.restore();
  }

  return {
    app,
    resume,
    letter,
    company,
    async cleanup() {
      await deleteApplicationRow(app.id);
      await deleteResumeRow(resume.id);
      if (letter) await deleteCoverLetterRow(letter.id);
    },
  };
}

/**
 * Runs `work` inside a transaction that stays open, holding whatever locks
 * it took, until `commit()`: how a test puts a concurrent writer exactly
 * where it wants one. `waitForWaiter()` resolves once another connection is
 * blocked on one of those locks, so what the test does next happens while
 * it waits, not before or after.
 */
async function holdTransaction(work: (tx: Executor) => Promise<void>) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: (pid: number) => void;
  const pid = new Promise<number>((resolve) => {
    locked = resolve;
  });

  const done = db.transaction(async (tx) => {
    await work(tx);
    const [row] = await tx.execute<{ pid: number }>('select pg_backend_pid() as pid');
    if (!row) throw new Error('no backend pid');
    locked(row.pid);
    await released;
  });
  const holder = await Promise.race([
    pid,
    done.then(() => {
      throw new Error('the held transaction ended before it took the lock');
    }),
  ]);

  return {
    async waitForWaiter(): Promise<void> {
      for (let attempt = 0; attempt < 400; attempt++) {
        const [row] = await sql<{ waiting: number }[]>`
          select count(*)::int as waiting from pg_stat_activity
          where ${holder}::int = any(pg_blocking_pids(pid))`;
        if ((row?.waiting ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`nothing waited on backend ${holder}'s lock`);
    },
    async commit(): Promise<void> {
      release();
      await done;
    },
  };
}

/** Writes `patch` to an application and holds the row's lock (`holdTransaction`). */
export function holdApplicationWrite(id: string, patch: Partial<typeof application.$inferInsert>) {
  return holdTransaction(async (tx) => {
    await tx.update(application).set(patch).where(eq(application.id, id));
  });
}

/** An answer write as `updateApplicationQuestion` makes one: the
 *  application locked first, then the question unapproved, held open. */
export function holdAnswerWrite(applicationId: string, questionId: string) {
  return holdTransaction(async (tx) => {
    await tx.select().from(application).where(eq(application.id, applicationId)).for('update');
    await tx
      .update(applicationQuestion)
      .set({ approvedAt: null })
      .where(eq(applicationQuestion.id, questionId));
  });
}

/** Every `resume_pdf` row a resume has, newest first, bytes excluded. */
export async function listResumePdfIds(resumeId: string): Promise<string[]> {
  const rows = await db
    .select({ id: resumePdf.id })
    .from(resumePdf)
    .where(eq(resumePdf.resumeId, resumeId))
    .orderBy(desc(resumePdf.createdAt), desc(resumePdf.id));
  return rows.map((row) => row.id);
}

/** Every file on an application, archived ones included, bytes included. */
export async function listApplicationFileRows(applicationId: string) {
  return db
    .select()
    .from(applicationFile)
    .where(eq(applicationFile.applicationId, applicationId))
    .orderBy(asc(applicationFile.createdAt), asc(applicationFile.id));
}

/**
 * `postgres.js` keeps its pool (and, per docs, each `db.transaction`'s
 * reserved connection) open indefinitely — required for a long-lived Next.js
 * server, but it means a `node --test` process for these files never exits
 * on its own. Every `*.test.ts` file here calls this from a top-level
 * `after()`.
 */
export async function closeTestDb(): Promise<void> {
  await sql.end({ timeout: 1 });
}
