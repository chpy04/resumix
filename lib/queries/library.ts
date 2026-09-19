/**
 * Assembles the global `Library` (D-012): all experiences/projects/skill
 * rows/templates with their children attached, optionally including
 * archived rows. A handful of flat queries plus in-memory grouping — no
 * per-row lookups.
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  experience,
  experienceBullet,
  project,
  projectBullet,
  technicalSkill,
  technicalSkillRow,
} from '../db/schema.ts';
import type { Bullet, Experience, Library, Project, Skill, SkillRow } from '../types.ts';
import { listTemplates } from './templates.ts';

function bulletsByParent(bullets: (Bullet & { parentId: string })[]): Map<string, Bullet[]> {
  const map = new Map<string, Bullet[]>();
  for (const bullet of bullets) {
    const list = map.get(bullet.parentId) ?? [];
    list.push({ id: bullet.id, content: bullet.content, isArchived: bullet.isArchived });
    map.set(bullet.parentId, list);
  }
  return map;
}

async function listExperiencesWithBullets(includeArchived: boolean): Promise<Experience[]> {
  const experienceRows = await db
    .select()
    .from(experience)
    .where(includeArchived ? undefined : eq(experience.isArchived, false))
    .orderBy(asc(experience.createdAt));

  const bulletRows = await db
    .select({
      id: experienceBullet.id,
      content: experienceBullet.content,
      isArchived: experienceBullet.isArchived,
      parentId: experienceBullet.experienceId,
    })
    .from(experienceBullet)
    .where(includeArchived ? undefined : eq(experienceBullet.isArchived, false))
    .orderBy(asc(experienceBullet.createdAt));

  const byExperience = bulletsByParent(bulletRows);

  return experienceRows.map((row) => ({
    id: row.id,
    company: row.company,
    title: row.title,
    dateRange: row.dateRange,
    location: row.location,
    isArchived: row.isArchived,
    bullets: byExperience.get(row.id) ?? [],
  }));
}

async function listProjectsWithBullets(includeArchived: boolean): Promise<Project[]> {
  const projectRows = await db
    .select()
    .from(project)
    .where(includeArchived ? undefined : eq(project.isArchived, false))
    .orderBy(asc(project.createdAt));

  const bulletRows = await db
    .select({
      id: projectBullet.id,
      content: projectBullet.content,
      isArchived: projectBullet.isArchived,
      parentId: projectBullet.projectId,
    })
    .from(projectBullet)
    .where(includeArchived ? undefined : eq(projectBullet.isArchived, false))
    .orderBy(asc(projectBullet.createdAt));

  const byProject = bulletsByParent(bulletRows);

  return projectRows.map((row) => ({
    id: row.id,
    name: row.name,
    technologies: row.technologies,
    dateRange: row.dateRange,
    isArchived: row.isArchived,
    bullets: byProject.get(row.id) ?? [],
  }));
}

async function listSkillRowsWithSkills(includeArchived: boolean): Promise<SkillRow[]> {
  const rowRows = await db
    .select()
    .from(technicalSkillRow)
    .where(includeArchived ? undefined : eq(technicalSkillRow.isArchived, false))
    .orderBy(asc(technicalSkillRow.createdAt));

  const skillRows = await db
    .select({
      id: technicalSkill.id,
      content: technicalSkill.name,
      isArchived: technicalSkill.isArchived,
      parentId: technicalSkill.technicalSkillRowId,
    })
    .from(technicalSkill)
    .where(includeArchived ? undefined : eq(technicalSkill.isArchived, false))
    .orderBy(asc(technicalSkill.createdAt));

  const bySkillRow = bulletsByParent(skillRows);

  return rowRows.map((row) => ({
    id: row.id,
    name: row.name,
    top: row.top,
    separator: row.separator,
    isArchived: row.isArchived,
    skills: (bySkillRow.get(row.id) ?? []).map(
      (b): Skill => ({ id: b.id, name: b.content, isArchived: b.isArchived }),
    ),
  }));
}

export async function assembleLibrary(includeArchived: boolean): Promise<Library> {
  const [experiences, projects, skillRows, templates] = await Promise.all([
    listExperiencesWithBullets(includeArchived),
    listProjectsWithBullets(includeArchived),
    listSkillRowsWithSkills(includeArchived),
    listTemplates(includeArchived),
  ]);

  return { experiences, projects, skillRows, templates };
}
