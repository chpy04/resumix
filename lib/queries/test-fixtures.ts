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
import { and, asc, eq } from 'drizzle-orm';
import { db, sql } from '../db/index.ts';
import {
  experience,
  experienceBullet,
  project,
  projectBullet,
  resume,
  technicalSkill,
  technicalSkillRow,
  users,
} from '../db/schema.ts';
import type { User } from '../types.ts';
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
