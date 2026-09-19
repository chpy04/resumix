import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { project, projectBullet } from '../db/schema.ts';
import type { Bullet } from '../types.ts';
import { NotFoundError } from './errors.ts';

function toWire(row: typeof projectBullet.$inferSelect): Bullet {
  return { id: row.id, content: row.content, isArchived: row.isArchived };
}

/** Ownership comes from the parent project — see experience-bullets.ts. */
async function assertOwned(userId: string, bulletId: string): Promise<void> {
  const [row] = await db
    .select({ id: projectBullet.id })
    .from(projectBullet)
    .innerJoin(project, eq(projectBullet.projectId, project.id))
    .where(and(eq(projectBullet.id, bulletId), eq(project.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError(`project bullet ${bulletId} not found`);
}

export async function createProjectBullet(
  userId: string,
  projectId: string,
  content: string,
): Promise<Bullet> {
  const [parent] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))
    .limit(1);
  if (!parent) throw new NotFoundError(`project ${projectId} not found`);

  const [row] = await db.insert(projectBullet).values({ projectId, content }).returning();
  if (!row) throw new Error('failed to create project bullet');
  return toWire(row);
}

export async function updateProjectBullet(
  userId: string,
  id: string,
  patch: Partial<{ content: string; isArchived: boolean }>,
): Promise<Bullet> {
  await assertOwned(userId, id);

  const [row] = await db
    .update(projectBullet)
    .set(patch)
    .where(eq(projectBullet.id, id))
    .returning();
  if (!row) throw new NotFoundError(`project bullet ${id} not found`);
  return toWire(row);
}
