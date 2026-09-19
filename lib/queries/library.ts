/**
 * Assembles one user's `Library` (D-012): their experiences/projects/skill
 * rows/templates with their children attached, optionally including
 * archived rows. A handful of flat queries plus in-memory grouping — no
 * per-row lookups.
 *
 * Every query here is filtered by `userId`. Child rows (bullets, skills)
 * carry no owner of their own, so they are filtered through a join to their
 * parent — the parent's `user_id` is the single source of truth for who
 * owns a bullet (docs/SCHEMA.md).
 */
import { and, asc, eq } from 'drizzle-orm';
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

async function listExperiencesWithBullets(
  userId: string,
  includeArchived: boolean,
): Promise<Experience[]> {
  const experienceRows = await db
    .select()
    .from(experience)
    .where(
      includeArchived
        ? eq(experience.userId, userId)
        : and(eq(experience.userId, userId), eq(experience.isArchived, false)),
    )
    // `created_at` alone is not a total order, so it is not an order at all:
    // `defaultNow()` is Postgres `now()`, which is *transaction*-start time,
    // so every row written in one transaction shares a timestamp — the seed
    // gives all five of an experience's bullets the same one. A tie lets the
    // planner return them in whatever order the scan yields, and an UPDATE
    // rewrites the heap tuple, so editing a bullet is exactly what reshuffles
    // it. The `id` tiebreaker makes the result reproducible (D-030).
    .orderBy(asc(experience.createdAt), asc(experience.id));

  const bulletRows = await db
    .select({
      id: experienceBullet.id,
      content: experienceBullet.content,
      isArchived: experienceBullet.isArchived,
      parentId: experienceBullet.experienceId,
    })
    .from(experienceBullet)
    .innerJoin(experience, eq(experienceBullet.experienceId, experience.id))
    .where(
      includeArchived
        ? eq(experience.userId, userId)
        : and(eq(experience.userId, userId), eq(experienceBullet.isArchived, false)),
    )
    // Tie-broken on id, as above (D-030).
    .orderBy(asc(experienceBullet.createdAt), asc(experienceBullet.id));

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

async function listProjectsWithBullets(
  userId: string,
  includeArchived: boolean,
): Promise<Project[]> {
  const projectRows = await db
    .select()
    .from(project)
    .where(
      includeArchived
        ? eq(project.userId, userId)
        : and(eq(project.userId, userId), eq(project.isArchived, false)),
    )
    // Tie-broken on id, as above (D-030).
    .orderBy(asc(project.createdAt), asc(project.id));

  const bulletRows = await db
    .select({
      id: projectBullet.id,
      content: projectBullet.content,
      isArchived: projectBullet.isArchived,
      parentId: projectBullet.projectId,
    })
    .from(projectBullet)
    .innerJoin(project, eq(projectBullet.projectId, project.id))
    .where(
      includeArchived
        ? eq(project.userId, userId)
        : and(eq(project.userId, userId), eq(projectBullet.isArchived, false)),
    )
    // Tie-broken on id, as above (D-030).
    .orderBy(asc(projectBullet.createdAt), asc(projectBullet.id));

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

async function listSkillRowsWithSkills(
  userId: string,
  includeArchived: boolean,
): Promise<SkillRow[]> {
  const rowRows = await db
    .select()
    .from(technicalSkillRow)
    .where(
      includeArchived
        ? eq(technicalSkillRow.userId, userId)
        : and(eq(technicalSkillRow.userId, userId), eq(technicalSkillRow.isArchived, false)),
    )
    // Tie-broken on id, as above (D-030).
    .orderBy(asc(technicalSkillRow.createdAt), asc(technicalSkillRow.id));

  const skillRows = await db
    .select({
      id: technicalSkill.id,
      content: technicalSkill.name,
      isArchived: technicalSkill.isArchived,
      parentId: technicalSkill.technicalSkillRowId,
    })
    .from(technicalSkill)
    .innerJoin(technicalSkillRow, eq(technicalSkill.technicalSkillRowId, technicalSkillRow.id))
    .where(
      includeArchived
        ? eq(technicalSkillRow.userId, userId)
        : and(eq(technicalSkillRow.userId, userId), eq(technicalSkill.isArchived, false)),
    )
    // Tie-broken on id, as above (D-030).
    .orderBy(asc(technicalSkill.createdAt), asc(technicalSkill.id));

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

export async function assembleLibrary(userId: string, includeArchived: boolean): Promise<Library> {
  const [experiences, projects, skillRows, templates] = await Promise.all([
    listExperiencesWithBullets(userId, includeArchived),
    listProjectsWithBullets(userId, includeArchived),
    listSkillRowsWithSkills(userId, includeArchived),
    listTemplates(userId, includeArchived),
  ]);

  return { experiences, projects, skillRows, templates };
}
