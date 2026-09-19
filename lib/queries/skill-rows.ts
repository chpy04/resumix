import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { technicalSkill, technicalSkillRow } from '../db/schema.ts';
import type { Skill, SkillRow } from '../types.ts';
import { NotFoundError } from './errors.ts';

function toWire(row: typeof technicalSkillRow.$inferSelect, skills: Skill[]): SkillRow {
  return {
    id: row.id,
    name: row.name,
    top: row.top,
    separator: row.separator,
    isArchived: row.isArchived,
    skills,
  };
}

export async function createSkillRow(data: {
  name: string;
  top: boolean;
  separator?: string;
}): Promise<SkillRow> {
  const [row] = await db
    .insert(technicalSkillRow)
    .values(data.separator !== undefined ? data : { name: data.name, top: data.top })
    .returning();
  if (!row) throw new Error('failed to create skill row');
  return toWire(row, []);
}

export async function updateSkillRow(
  id: string,
  patch: Partial<{ name: string; top: boolean; separator: string; isArchived: boolean }>,
): Promise<SkillRow> {
  const [row] = await db
    .update(technicalSkillRow)
    .set(patch)
    .where(eq(technicalSkillRow.id, id))
    .returning();
  if (!row) throw new NotFoundError(`skill row ${id} not found`);

  const skills = await db
    .select({
      id: technicalSkill.id,
      name: technicalSkill.name,
      isArchived: technicalSkill.isArchived,
    })
    .from(technicalSkill)
    .where(eq(technicalSkill.technicalSkillRowId, id))
    .orderBy(asc(technicalSkill.createdAt));

  return toWire(row, skills);
}

export async function getSkillRowById(id: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: technicalSkillRow.id })
    .from(technicalSkillRow)
    .where(eq(technicalSkillRow.id, id))
    .limit(1);
  return row ?? null;
}
