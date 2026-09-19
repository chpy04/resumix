import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { technicalSkill, technicalSkillRow } from '../db/schema.ts';
import type { SkillRow } from '../types.ts';
import { NotFoundError } from './errors.ts';

export async function createSkillRow(
  userId: string,
  data: {
    name: string;
    top: boolean;
    separator?: string;
  },
): Promise<SkillRow> {
  const [row] = await db
    .insert(technicalSkillRow)
    .values(
      data.separator !== undefined
        ? { name: data.name, top: data.top, separator: data.separator, userId }
        : { name: data.name, top: data.top, userId },
    )
    .returning();
  if (!row) throw new Error('failed to create skill row');
  return { ...row, skills: [] };
}

export async function updateSkillRow(
  userId: string,
  id: string,
  patch: Partial<{ name: string; top: boolean; separator: string; isArchived: boolean }>,
): Promise<SkillRow> {
  const [row] = await db
    .update(technicalSkillRow)
    .set(patch)
    .where(and(eq(technicalSkillRow.id, id), eq(technicalSkillRow.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`skill row ${id} not found`);

  const skills = await db
    .select()
    .from(technicalSkill)
    .where(eq(technicalSkill.technicalSkillRowId, id))
    .orderBy(asc(technicalSkill.createdAt));

  return { ...row, skills };
}

/** See `getExperienceById` — null covers both "missing" and "not yours". */
export async function getSkillRowById(userId: string, id: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: technicalSkillRow.id })
    .from(technicalSkillRow)
    .where(and(eq(technicalSkillRow.id, id), eq(technicalSkillRow.userId, userId)))
    .limit(1);
  return row ?? null;
}
