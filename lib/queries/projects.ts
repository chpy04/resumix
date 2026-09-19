import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { project, projectBullet } from '../db/schema.ts';
import type { Bullet, Project } from '../types.ts';
import { NotFoundError } from './errors.ts';

/** Row -> wire. Explicit rather than `{ ...row }`: the row carries `userId`
 *  and timestamps that have no business leaving the server. */
function toWire(row: typeof project.$inferSelect, bullets: Bullet[]): Project {
  return {
    id: row.id,
    name: row.name,
    technologies: row.technologies,
    dateRange: row.dateRange,
    isArchived: row.isArchived,
    bullets,
  };
}

export async function createProject(
  userId: string,
  data: {
    name: string;
    technologies: string;
    dateRange: string;
  },
): Promise<Project> {
  const [row] = await db
    .insert(project)
    .values({ ...data, userId })
    .returning();
  if (!row) throw new Error('failed to create project');
  return toWire(row, []);
}

export async function updateProject(
  userId: string,
  id: string,
  patch: Partial<{ name: string; technologies: string; dateRange: string; isArchived: boolean }>,
): Promise<Project> {
  const [row] = await db
    .update(project)
    .set(patch)
    .where(and(eq(project.id, id), eq(project.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`project ${id} not found`);

  const bullets = await db
    .select({
      id: projectBullet.id,
      content: projectBullet.content,
      isArchived: projectBullet.isArchived,
    })
    .from(projectBullet)
    .where(eq(projectBullet.projectId, id))
    // The id breaks ties; the first column is not unique (D-030).
    .orderBy(asc(projectBullet.createdAt), asc(projectBullet.id));

  return toWire(row, bullets);
}

/** See `getExperienceById` — null covers both "missing" and "not yours". */
export async function getProjectById(userId: string, id: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, id), eq(project.userId, userId)))
    .limit(1);
  return row ?? null;
}
