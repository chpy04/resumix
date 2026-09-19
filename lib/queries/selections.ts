/**
 * Reading and replacing a resume's Selections (docs/API.md, "Selections").
 *
 * `replaceSelections` is the autosave target. For each slice present in the
 * partial body it deletes the resume's rows for that slice and re-inserts
 * with `sort_order` = array index, all inside one transaction. Slices
 * absent from the body are left untouched. Any id that doesn't exist in the
 * corresponding content table (or, for bullets, doesn't belong to the
 * parent it's nested under) aborts the whole transaction with a
 * `BadRequestError` — never a dangling row.
 *
 * Six slices, six near-identical bodies below rather than one generic
 * helper: the six bridge tables don't share a common Drizzle table shape,
 * and fighting the type system to unify them bought nothing but `any`.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { db } from '../db/index.ts';
import {
  experience,
  experienceBullet,
  project,
  projectBullet,
  resumeExperience,
  resumeExperienceBullet,
  resumeProject,
  resumeProjectBullet,
  resumeTechnicalSkill,
  resumeTechnicalSkillRow,
  technicalSkill,
  technicalSkillRow,
} from '../db/schema.ts';
import type { Selections } from '../types.ts';
import { BadRequestError } from './errors.ts';

type Tx = PgTransaction<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function getSelections(resumeId: string): Promise<Selections> {
  const [experiences, experienceBullets, projects, projectBullets, skillRows, skills] =
    await Promise.all([
      db
        .select({ id: resumeExperience.experienceId })
        .from(resumeExperience)
        .where(eq(resumeExperience.resumeId, resumeId))
        .orderBy(asc(resumeExperience.sortOrder)),
      db
        .select({
          bulletId: resumeExperienceBullet.experienceBulletId,
          experienceId: experienceBullet.experienceId,
        })
        .from(resumeExperienceBullet)
        .innerJoin(
          experienceBullet,
          eq(resumeExperienceBullet.experienceBulletId, experienceBullet.id),
        )
        .where(eq(resumeExperienceBullet.resumeId, resumeId))
        .orderBy(asc(resumeExperienceBullet.sortOrder)),
      db
        .select({ id: resumeProject.projectId })
        .from(resumeProject)
        .where(eq(resumeProject.resumeId, resumeId))
        .orderBy(asc(resumeProject.sortOrder)),
      db
        .select({
          bulletId: resumeProjectBullet.projectBulletId,
          projectId: projectBullet.projectId,
        })
        .from(resumeProjectBullet)
        .innerJoin(projectBullet, eq(resumeProjectBullet.projectBulletId, projectBullet.id))
        .where(eq(resumeProjectBullet.resumeId, resumeId))
        .orderBy(asc(resumeProjectBullet.sortOrder)),
      db
        .select({ id: resumeTechnicalSkillRow.technicalSkillRowId })
        .from(resumeTechnicalSkillRow)
        .where(eq(resumeTechnicalSkillRow.resumeId, resumeId))
        .orderBy(asc(resumeTechnicalSkillRow.sortOrder)),
      db
        .select({
          skillId: resumeTechnicalSkill.technicalSkillId,
          rowId: technicalSkill.technicalSkillRowId,
        })
        .from(resumeTechnicalSkill)
        .innerJoin(technicalSkill, eq(resumeTechnicalSkill.technicalSkillId, technicalSkill.id))
        .where(eq(resumeTechnicalSkill.resumeId, resumeId))
        .orderBy(asc(resumeTechnicalSkill.sortOrder)),
    ]);

  const experienceBulletsMap: Record<string, string[]> = {};
  for (const row of experienceBullets) {
    (experienceBulletsMap[row.experienceId] ??= []).push(row.bulletId);
  }

  const projectBulletsMap: Record<string, string[]> = {};
  for (const row of projectBullets) {
    (projectBulletsMap[row.projectId] ??= []).push(row.bulletId);
  }

  const skillsMap: Record<string, string[]> = {};
  for (const row of skills) {
    (skillsMap[row.rowId] ??= []).push(row.skillId);
  }

  return {
    experiences: experiences.map((r) => r.id),
    experienceBullets: experienceBulletsMap,
    projects: projects.map((r) => r.id),
    projectBullets: projectBulletsMap,
    skillRows: skillRows.map((r) => r.id),
    skills: skillsMap,
  };
}

function assertNoMissing(ids: string[], found: Set<string>, label: string): void {
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new BadRequestError(`unknown ${label} id(s): ${[...new Set(missing)].join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Top-level slices: experiences / projects / skillRows
// ---------------------------------------------------------------------------

async function replaceExperiences(tx: Tx, resumeId: string, ids: string[]): Promise<void> {
  if (ids.length > 0) {
    const rows = await tx
      .select({ id: experience.id })
      .from(experience)
      .where(inArray(experience.id, [...new Set(ids)]));
    assertNoMissing(ids, new Set(rows.map((r) => r.id)), 'experience');
  }
  await tx.delete(resumeExperience).where(eq(resumeExperience.resumeId, resumeId));
  if (ids.length === 0) return;
  await tx
    .insert(resumeExperience)
    .values(ids.map((experienceId, index) => ({ resumeId, experienceId, sortOrder: index })));
}

async function replaceProjects(tx: Tx, resumeId: string, ids: string[]): Promise<void> {
  if (ids.length > 0) {
    const rows = await tx
      .select({ id: project.id })
      .from(project)
      .where(inArray(project.id, [...new Set(ids)]));
    assertNoMissing(ids, new Set(rows.map((r) => r.id)), 'project');
  }
  await tx.delete(resumeProject).where(eq(resumeProject.resumeId, resumeId));
  if (ids.length === 0) return;
  await tx
    .insert(resumeProject)
    .values(ids.map((projectId, index) => ({ resumeId, projectId, sortOrder: index })));
}

async function replaceSkillRows(tx: Tx, resumeId: string, ids: string[]): Promise<void> {
  if (ids.length > 0) {
    const rows = await tx
      .select({ id: technicalSkillRow.id })
      .from(technicalSkillRow)
      .where(inArray(technicalSkillRow.id, [...new Set(ids)]));
    assertNoMissing(ids, new Set(rows.map((r) => r.id)), 'skill row');
  }
  await tx.delete(resumeTechnicalSkillRow).where(eq(resumeTechnicalSkillRow.resumeId, resumeId));
  if (ids.length === 0) return;
  await tx.insert(resumeTechnicalSkillRow).values(
    ids.map((technicalSkillRowId, index) => ({
      resumeId,
      technicalSkillRowId,
      sortOrder: index,
    })),
  );
}

// ---------------------------------------------------------------------------
// Nested slices: experienceBullets / projectBullets / skills
// ---------------------------------------------------------------------------

async function replaceExperienceBullets(
  tx: Tx,
  resumeId: string,
  byParent: Record<string, string[]>,
): Promise<void> {
  const parentIds = Object.keys(byParent);
  const allBulletIds = parentIds.flatMap((id) => byParent[id] ?? []);

  if (allBulletIds.length > 0) {
    const unique = [...new Set(allBulletIds)];
    const rows = await tx
      .select({ id: experienceBullet.id, parentId: experienceBullet.experienceId })
      .from(experienceBullet)
      .where(inArray(experienceBullet.id, unique));
    const byId = new Map(rows.map((r) => [r.id, r.parentId]));
    assertNoMissing(unique, new Set(byId.keys()), 'experience bullet');
    for (const parentId of parentIds) {
      for (const bulletId of byParent[parentId] ?? []) {
        if (byId.get(bulletId) !== parentId) {
          throw new BadRequestError(
            `experience bullet id "${bulletId}" does not belong to experience "${parentId}"`,
          );
        }
      }
    }
  }

  await tx.delete(resumeExperienceBullet).where(eq(resumeExperienceBullet.resumeId, resumeId));

  const values = parentIds.flatMap((parentId) =>
    (byParent[parentId] ?? []).map((experienceBulletId, index) => ({
      resumeId,
      experienceBulletId,
      sortOrder: index,
    })),
  );
  if (values.length === 0) return;
  await tx.insert(resumeExperienceBullet).values(values);
}

async function replaceProjectBullets(
  tx: Tx,
  resumeId: string,
  byParent: Record<string, string[]>,
): Promise<void> {
  const parentIds = Object.keys(byParent);
  const allBulletIds = parentIds.flatMap((id) => byParent[id] ?? []);

  if (allBulletIds.length > 0) {
    const unique = [...new Set(allBulletIds)];
    const rows = await tx
      .select({ id: projectBullet.id, parentId: projectBullet.projectId })
      .from(projectBullet)
      .where(inArray(projectBullet.id, unique));
    const byId = new Map(rows.map((r) => [r.id, r.parentId]));
    assertNoMissing(unique, new Set(byId.keys()), 'project bullet');
    for (const parentId of parentIds) {
      for (const bulletId of byParent[parentId] ?? []) {
        if (byId.get(bulletId) !== parentId) {
          throw new BadRequestError(
            `project bullet id "${bulletId}" does not belong to project "${parentId}"`,
          );
        }
      }
    }
  }

  await tx.delete(resumeProjectBullet).where(eq(resumeProjectBullet.resumeId, resumeId));

  const values = parentIds.flatMap((parentId) =>
    (byParent[parentId] ?? []).map((projectBulletId, index) => ({
      resumeId,
      projectBulletId,
      sortOrder: index,
    })),
  );
  if (values.length === 0) return;
  await tx.insert(resumeProjectBullet).values(values);
}

async function replaceSkills(
  tx: Tx,
  resumeId: string,
  byParent: Record<string, string[]>,
): Promise<void> {
  const parentIds = Object.keys(byParent);
  const allSkillIds = parentIds.flatMap((id) => byParent[id] ?? []);

  if (allSkillIds.length > 0) {
    const unique = [...new Set(allSkillIds)];
    const rows = await tx
      .select({ id: technicalSkill.id, parentId: technicalSkill.technicalSkillRowId })
      .from(technicalSkill)
      .where(inArray(technicalSkill.id, unique));
    const byId = new Map(rows.map((r) => [r.id, r.parentId]));
    assertNoMissing(unique, new Set(byId.keys()), 'skill');
    for (const parentId of parentIds) {
      for (const skillId of byParent[parentId] ?? []) {
        if (byId.get(skillId) !== parentId) {
          throw new BadRequestError(
            `skill id "${skillId}" does not belong to skill row "${parentId}"`,
          );
        }
      }
    }
  }

  await tx.delete(resumeTechnicalSkill).where(eq(resumeTechnicalSkill.resumeId, resumeId));

  const values = parentIds.flatMap((parentId) =>
    (byParent[parentId] ?? []).map((technicalSkillId, index) => ({
      resumeId,
      technicalSkillId,
      sortOrder: index,
    })),
  );
  if (values.length === 0) return;
  await tx.insert(resumeTechnicalSkill).values(values);
}

export async function replaceSelections(
  resumeId: string,
  patch: Partial<Selections>,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (patch.experiences !== undefined) {
      await replaceExperiences(tx, resumeId, patch.experiences);
    }
    if (patch.projects !== undefined) {
      await replaceProjects(tx, resumeId, patch.projects);
    }
    if (patch.skillRows !== undefined) {
      await replaceSkillRows(tx, resumeId, patch.skillRows);
    }
    if (patch.experienceBullets !== undefined) {
      await replaceExperienceBullets(tx, resumeId, patch.experienceBullets);
    }
    if (patch.projectBullets !== undefined) {
      await replaceProjectBullets(tx, resumeId, patch.projectBullets);
    }
    if (patch.skills !== undefined) {
      await replaceSkills(tx, resumeId, patch.skills);
    }
  });
}

/** Copies every one of a resume's six selection slices to another resume,
 * preserving order — used to clone the default resume (POST /resumes). */
export async function cloneSelections(fromResumeId: string, toResumeId: string): Promise<void> {
  const selections = await getSelections(fromResumeId);
  await replaceSelections(toResumeId, selections);
}
