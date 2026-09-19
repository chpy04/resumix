import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { experience, experienceBullet } from '../db/schema.ts';
import type { Bullet } from '../types.ts';
import { NotFoundError } from './errors.ts';

function toWire(row: typeof experienceBullet.$inferSelect): Bullet {
  return { id: row.id, content: row.content, isArchived: row.isArchived };
}

/**
 * A bullet has no `user_id` of its own — it belongs to whoever owns its
 * experience (docs/SCHEMA.md). Resolving that here, rather than trusting
 * the caller, is what keeps `PATCH /api/experience-bullets/:id` from being
 * a hole straight into another account's content.
 */
async function assertOwned(userId: string, bulletId: string): Promise<void> {
  const [row] = await db
    .select({ id: experienceBullet.id })
    .from(experienceBullet)
    .innerJoin(experience, eq(experienceBullet.experienceId, experience.id))
    .where(and(eq(experienceBullet.id, bulletId), eq(experience.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError(`experience bullet ${bulletId} not found`);
}

export async function createExperienceBullet(
  userId: string,
  experienceId: string,
  content: string,
): Promise<Bullet> {
  const [parent] = await db
    .select({ id: experience.id })
    .from(experience)
    .where(and(eq(experience.id, experienceId), eq(experience.userId, userId)))
    .limit(1);
  if (!parent) throw new NotFoundError(`experience ${experienceId} not found`);

  const [row] = await db.insert(experienceBullet).values({ experienceId, content }).returning();
  if (!row) throw new Error('failed to create experience bullet');
  return toWire(row);
}

export async function updateExperienceBullet(
  userId: string,
  id: string,
  patch: Partial<{ content: string; isArchived: boolean }>,
): Promise<Bullet> {
  await assertOwned(userId, id);

  const [row] = await db
    .update(experienceBullet)
    .set(patch)
    .where(eq(experienceBullet.id, id))
    .returning();
  if (!row) throw new NotFoundError(`experience bullet ${id} not found`);
  return toWire(row);
}
