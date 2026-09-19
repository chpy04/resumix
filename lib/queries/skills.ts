import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { technicalSkill } from '../db/schema.ts';
import type { Skill } from '../types.ts';
import { NotFoundError } from './errors.ts';

function toWire(row: typeof technicalSkill.$inferSelect): Skill {
  return { id: row.id, name: row.name, isArchived: row.isArchived };
}

export async function createSkill(technicalSkillRowId: string, name: string): Promise<Skill> {
  const [row] = await db.insert(technicalSkill).values({ technicalSkillRowId, name }).returning();
  if (!row) throw new Error('failed to create skill');
  return toWire(row);
}

export async function updateSkill(
  id: string,
  patch: Partial<{ name: string; isArchived: boolean }>,
): Promise<Skill> {
  const [row] = await db
    .update(technicalSkill)
    .set(patch)
    .where(eq(technicalSkill.id, id))
    .returning();
  if (!row) throw new NotFoundError(`skill ${id} not found`);
  return toWire(row);
}
