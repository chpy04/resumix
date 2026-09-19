import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { experience, experienceBullet } from '../db/schema.ts';
import type { Bullet, Experience } from '../types.ts';
import { NotFoundError } from './errors.ts';

/** Row -> wire. Explicit rather than `{ ...row }`: the row carries `userId`
 *  and timestamps that have no business leaving the server. */
function toWire(row: typeof experience.$inferSelect, bullets: Bullet[]): Experience {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    dateRange: row.dateRange,
    location: row.location,
    isArchived: row.isArchived,
    bullets,
  };
}

export async function createExperience(
  userId: string,
  data: {
    company: string;
    title: string;
    dateRange: string;
    location: string;
  },
): Promise<Experience> {
  const [row] = await db
    .insert(experience)
    .values({ ...data, userId })
    .returning();
  if (!row) throw new Error('failed to create experience');
  return toWire(row, []);
}

export async function updateExperience(
  userId: string,
  id: string,
  patch: Partial<{
    company: string;
    title: string;
    dateRange: string;
    location: string;
    isArchived: boolean;
  }>,
): Promise<Experience> {
  const [row] = await db
    .update(experience)
    .set(patch)
    .where(and(eq(experience.id, id), eq(experience.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`experience ${id} not found`);

  const bullets = await db
    .select({
      id: experienceBullet.id,
      content: experienceBullet.content,
      isArchived: experienceBullet.isArchived,
    })
    .from(experienceBullet)
    .where(eq(experienceBullet.experienceId, id))
    .orderBy(asc(experienceBullet.createdAt));

  return toWire(row, bullets);
}

/** Ownership check for routes that address an experience by id. Returns null
 *  for both "no such experience" and "someone else's experience". */
export async function getExperienceById(
  userId: string,
  id: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: experience.id })
    .from(experience)
    .where(and(eq(experience.id, id), eq(experience.userId, userId)))
    .limit(1);
  return row ?? null;
}
