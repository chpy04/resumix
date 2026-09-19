import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { experienceBullet } from '../db/schema.ts';
import type { Bullet } from '../types.ts';
import { NotFoundError } from './errors.ts';

function toWire(row: typeof experienceBullet.$inferSelect): Bullet {
  return { id: row.id, content: row.content, isArchived: row.isArchived };
}

export async function createExperienceBullet(
  experienceId: string,
  content: string,
): Promise<Bullet> {
  const [row] = await db.insert(experienceBullet).values({ experienceId, content }).returning();
  if (!row) throw new Error('failed to create experience bullet');
  return toWire(row);
}

export async function updateExperienceBullet(
  id: string,
  patch: Partial<{ content: string; isArchived: boolean }>,
): Promise<Bullet> {
  const [row] = await db
    .update(experienceBullet)
    .set(patch)
    .where(eq(experienceBullet.id, id))
    .returning();
  if (!row) throw new NotFoundError(`experience bullet ${id} not found`);
  return toWire(row);
}
