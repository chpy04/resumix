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
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, sql } from '../db/index.ts';
import {
  experience,
  experienceBullet,
  project,
  projectBullet,
  resume,
  technicalSkill,
  technicalSkillRow,
} from '../db/schema.ts';

export const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Unique-ish tag so fixture rows are identifiable in a shared dev database. */
export function testTag(): string {
  return randomUUID().slice(0, 8);
}

export async function insertExperience(
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
    })
    .returning();
  if (!row) throw new Error('failed to insert test experience');
  return row;
}

export async function insertExperienceBullet(
  experienceId: string,
  content: string,
  isArchived = false,
) {
  const [row] = await db
    .insert(experienceBullet)
    .values({ experienceId, content, isArchived })
    .returning();
  if (!row) throw new Error('failed to insert test experience bullet');
  return row;
}

export async function insertProject(tag: string) {
  const [row] = await db
    .insert(project)
    .values({
      name: `T6 Test Project ${tag}`,
      technologies: 'TypeScript',
      dateRange: '2022',
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

export async function insertSkillRow(tag: string) {
  const [row] = await db
    .insert(technicalSkillRow)
    .values({ name: `T6 Test Skills ${tag}`, top: true })
    .returning();
  if (!row) throw new Error('failed to insert test skill row');
  return row;
}

export async function insertSkill(technicalSkillRowId: string, name: string) {
  const [row] = await db.insert(technicalSkill).values({ technicalSkillRowId, name }).returning();
  if (!row) throw new Error('failed to insert test skill');
  return row;
}

export async function getDefaultResumeRow() {
  const [row] = await db.select().from(resume).where(eq(resume.isDefault, true)).limit(1);
  if (!row)
    throw new Error('no default resume/template seeded — run scripts/migrate.ts and seed one');
  return row;
}

/** Inserts a throwaway (non-default) resume against the seeded default template. */
export async function insertTestResume(tag: string) {
  const defaultResume = await getDefaultResumeRow();
  const [row] = await db
    .insert(resume)
    .values({ name: `T6 Test Resume ${tag}`, templateId: defaultResume.templateId })
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
