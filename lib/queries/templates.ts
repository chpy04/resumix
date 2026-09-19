import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { template } from '../db/schema.ts';
import type { Template } from '../types.ts';
import { NotFoundError } from './errors.ts';

function toWire(row: typeof template.$inferSelect): Template {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    isDefault: row.isDefault,
    isArchived: row.isArchived,
  };
}

export async function listTemplates(includeArchived: boolean): Promise<Template[]> {
  const rows = await db
    .select()
    .from(template)
    .where(includeArchived ? undefined : eq(template.isArchived, false))
    .orderBy(asc(template.name));
  return rows.map(toWire);
}

export async function getTemplateById(id: string): Promise<Template | null> {
  const [row] = await db.select().from(template).where(eq(template.id, id)).limit(1);
  return row ? toWire(row) : null;
}

export async function getDefaultTemplate(): Promise<Template | null> {
  const [row] = await db.select().from(template).where(eq(template.isDefault, true)).limit(1);
  return row ? toWire(row) : null;
}

export async function updateTemplate(
  id: string,
  patch: { name?: string; content?: string; isArchived?: boolean },
): Promise<Template> {
  const [row] = await db
    .update(template)
    .set(patch)
    .where(eq(template.id, id))
    .returning();
  if (!row) throw new NotFoundError(`template ${id} not found`);
  return toWire(row);
}
