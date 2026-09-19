import { and, asc, eq } from 'drizzle-orm';
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

export async function listTemplates(userId: string, includeArchived: boolean): Promise<Template[]> {
  const rows = await db
    .select()
    .from(template)
    .where(
      includeArchived
        ? eq(template.userId, userId)
        : and(eq(template.userId, userId), eq(template.isArchived, false)),
    )
    // The id breaks ties; the first column is not unique (D-030).
    .orderBy(asc(template.name), asc(template.id));
  return rows.map(toWire);
}

/** Scoped by owner: another user's template id reads as "not found", which is
 *  what every caller here already knows how to handle. */
export async function getTemplateById(userId: string, id: string): Promise<Template | null> {
  const [row] = await db
    .select()
    .from(template)
    .where(and(eq(template.id, id), eq(template.userId, userId)))
    .limit(1);
  return row ? toWire(row) : null;
}

export async function getDefaultTemplate(userId: string): Promise<Template | null> {
  const [row] = await db
    .select()
    .from(template)
    .where(and(eq(template.userId, userId), eq(template.isDefault, true)))
    .limit(1);
  return row ? toWire(row) : null;
}

export async function updateTemplate(
  userId: string,
  id: string,
  patch: { name?: string; content?: string; isArchived?: boolean },
): Promise<Template> {
  const [row] = await db
    .update(template)
    .set(patch)
    .where(and(eq(template.id, id), eq(template.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`template ${id} not found`);
  return toWire(row);
}
