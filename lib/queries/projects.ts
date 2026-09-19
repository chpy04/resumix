import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { project, projectBullet } from '../db/schema.ts';
import type { Project } from '../types.ts';
import { NotFoundError } from './errors.ts';

export async function createProject(data: {
  name: string;
  technologies: string;
  dateRange: string;
}): Promise<Project> {
  const [row] = await db.insert(project).values(data).returning();
  if (!row) throw new Error('failed to create project');
  return { ...row, bullets: [] };
}

export async function updateProject(
  id: string,
  patch: Partial<{ name: string; technologies: string; dateRange: string; isArchived: boolean }>,
): Promise<Project> {
  const [row] = await db.update(project).set(patch).where(eq(project.id, id)).returning();
  if (!row) throw new NotFoundError(`project ${id} not found`);

  const bullets = await db
    .select()
    .from(projectBullet)
    .where(eq(projectBullet.projectId, id))
    .orderBy(asc(projectBullet.createdAt));

  return { ...row, bullets };
}

export async function getProjectById(id: string): Promise<{ id: string } | null> {
  const [row] = await db.select({ id: project.id }).from(project).where(eq(project.id, id)).limit(1);
  return row ?? null;
}
