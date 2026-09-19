import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { technicalSkill, technicalSkillRow } from '../db/schema.ts';
import type { Skill } from '../types.ts';
import { NotFoundError } from './errors.ts';

function toWire(row: typeof technicalSkill.$inferSelect): Skill {
  return { id: row.id, name: row.name, isArchived: row.isArchived };
}

/** Ownership comes from the parent skill row — see experience-bullets.ts. */
async function assertOwned(userId: string, skillId: string): Promise<void> {
  const [row] = await db
    .select({ id: technicalSkill.id })
    .from(technicalSkill)
    .innerJoin(technicalSkillRow, eq(technicalSkill.technicalSkillRowId, technicalSkillRow.id))
    .where(and(eq(technicalSkill.id, skillId), eq(technicalSkillRow.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError(`skill ${skillId} not found`);
}

export async function createSkill(
  userId: string,
  technicalSkillRowId: string,
  name: string,
): Promise<Skill> {
  const [parent] = await db
    .select({ id: technicalSkillRow.id })
    .from(technicalSkillRow)
    .where(and(eq(technicalSkillRow.id, technicalSkillRowId), eq(technicalSkillRow.userId, userId)))
    .limit(1);
  if (!parent) throw new NotFoundError(`skill row ${technicalSkillRowId} not found`);

  const [row] = await db.insert(technicalSkill).values({ technicalSkillRowId, name }).returning();
  if (!row) throw new Error('failed to create skill');
  return toWire(row);
}

export async function updateSkill(
  userId: string,
  id: string,
  patch: Partial<{ name: string; isArchived: boolean }>,
): Promise<Skill> {
  await assertOwned(userId, id);

  const [row] = await db
    .update(technicalSkill)
    .set(patch)
    .where(eq(technicalSkill.id, id))
    .returning();
  if (!row) throw new NotFoundError(`skill ${id} not found`);
  return toWire(row);
}
