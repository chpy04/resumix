import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { projectBullet } from '../db/schema.ts';
import type { Bullet } from '../types.ts';
import { NotFoundError } from './errors.ts';

function toWire(row: typeof projectBullet.$inferSelect): Bullet {
  return { id: row.id, content: row.content, isArchived: row.isArchived };
}

export async function createProjectBullet(projectId: string, content: string): Promise<Bullet> {
  const [row] = await db.insert(projectBullet).values({ projectId, content }).returning();
  if (!row) throw new Error('failed to create project bullet');
  return toWire(row);
}

export async function updateProjectBullet(
  id: string,
  patch: Partial<{ content: string; isArchived: boolean }>,
): Promise<Bullet> {
  const [row] = await db
    .update(projectBullet)
    .set(patch)
    .where(eq(projectBullet.id, id))
    .returning();
  if (!row) throw new NotFoundError(`project bullet ${id} not found`);
  return toWire(row);
}
