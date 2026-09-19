/**
 * Seeds the database with:
 *   - one user, who owns everything below (`SEED_USER_EMAIL`, defaulting to
 *     the address in the reference resume's header)
 *   - that user's default template (DEFAULT_TEMPLATE, name "Default",
 *     is_default true)
 *   - all content transcribed from docs/reference/v1-resume.tex (lib/seed-data/**)
 *   - a "Default" resume (is_default true) pointing at that template, with
 *     every piece of seeded content selected, in the reference resume's order
 *
 * This is the project's smoke test: representing the user's real resume
 * within the schema is the acceptance bar (see docs/agents/t5.md).
 *
 * The single user it creates is also what makes `dev` auth mode work — the
 * app logs in as the first user in the table with no password (see
 * `lib/auth-mode.ts`), so a fresh clone goes from `db:seed` to a usable app
 * with no credentials to configure.
 *
 * Idempotent: if a user already exists, the seed is a no-op unless --force
 * is passed. --force truncates every content + resume table first
 * (TRUNCATE ... CASCADE, which ignores the restrict/cascade delete actions
 * the tables normally use) and then reseeds from scratch.
 *
 * Usage:
 *   node --experimental-strip-types scripts/seed.ts
 *   node --experimental-strip-types scripts/seed.ts --force
 *   SEED_USER_EMAIL=someone@example.com node --experimental-strip-types scripts/seed.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../lib/db/schema.ts';
import { DEFAULT_TEMPLATE } from '../lib/render/default-template.ts';
import { V1_EXPERIENCES, V1_PROJECTS, V1_SKILL_ROWS } from '../lib/seed-data/v1-resume.ts';

const FORCE = process.argv.includes('--force');

/** The seeded user. Defaults to the address already in the reference
 *  resume's header, so a default seed is self-consistent. */
const SEED_USER_EMAIL = process.env.SEED_USER_EMAIL ?? 'pyle.c@northeastern.edu';
const SEED_USER_NAME = process.env.SEED_USER_NAME ?? 'Chris Pyle';

/** `INSERT ... RETURNING` always returns exactly one row for one inserted
 * value; this just gives TypeScript (noUncheckedIndexedAccess) that fact. */
function one<T>(rows: T[]): T {
  if (rows.length !== 1) {
    throw new Error(`expected exactly one row, got ${rows.length}`);
  }
  return rows[0] as T;
}

// Content + resume tables, in an order TRUNCATE...CASCADE can process safely.
// CASCADE makes the exact listed order irrelevant (it follows FKs itself),
// but it's listed leaves-first for readability.
const ALL_SEEDED_TABLES = [
  'resume_pdf',
  'resume_technical_skill',
  'resume_technical_skill_row',
  'resume_project_bullet',
  'resume_project',
  'resume_experience_bullet',
  'resume_experience',
  'resume',
  'technical_skill',
  'technical_skill_row',
  'project_bullet',
  'project',
  'experience_bullet',
  'experience',
  'template',
  'users',
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema });

  try {
    const [existingUser] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);

    if (existingUser && !FORCE) {
      console.log('Already seeded (a user exists) — nothing to do.');
      console.log('Pass --force to wipe and reseed.');
      return;
    }

    if (existingUser && FORCE) {
      console.log(`--force: truncating ${ALL_SEEDED_TABLES.length} tables before reseeding...`);
      await sql.unsafe(`truncate table ${ALL_SEEDED_TABLES.join(', ')} restart identity cascade`);
    }

    const summary = await db.transaction(async (tx) => {
      // Everything below hangs off this row. Nothing in the database is
      // ownerless (docs/SCHEMA.md), so the user has to exist first.
      const user = one(
        await tx
          .insert(schema.users)
          .values({ email: SEED_USER_EMAIL, name: SEED_USER_NAME })
          .returning({ id: schema.users.id }),
      );

      const tpl = one(
        await tx
          .insert(schema.template)
          .values({
            name: 'Default',
            content: DEFAULT_TEMPLATE,
            isDefault: true,
            userId: user.id,
          })
          .returning({ id: schema.template.id }),
      );

      // ---- Experiences + bullets --------------------------------------
      // Parallel arrays, one entry per V1_EXPERIENCES entry, in file order.
      const experiences: { experienceId: string; bulletIds: string[] }[] = [];
      for (const exp of V1_EXPERIENCES) {
        const row = one(
          await tx
            .insert(schema.experience)
            .values({
              company: exp.company,
              title: exp.title,
              dateRange: exp.dateRange,
              location: exp.location,
              userId: user.id,
            })
            .returning({ id: schema.experience.id }),
        );

        const bulletIds: string[] = [];
        for (const bullet of exp.bullets) {
          const brow = one(
            await tx
              .insert(schema.experienceBullet)
              .values({ experienceId: row.id, content: bullet.content })
              .returning({ id: schema.experienceBullet.id }),
          );
          bulletIds.push(brow.id);
        }
        experiences.push({ experienceId: row.id, bulletIds });
      }

      // ---- Projects + bullets ------------------------------------------
      const projects: { projectId: string; bulletIds: string[] }[] = [];
      for (const proj of V1_PROJECTS) {
        const row = one(
          await tx
            .insert(schema.project)
            .values({
              name: proj.name,
              technologies: proj.technologies,
              dateRange: proj.dateRange,
              userId: user.id,
            })
            .returning({ id: schema.project.id }),
        );

        const bulletIds: string[] = [];
        for (const bullet of proj.bullets) {
          const brow = one(
            await tx
              .insert(schema.projectBullet)
              .values({ projectId: row.id, content: bullet.content })
              .returning({ id: schema.projectBullet.id }),
          );
          bulletIds.push(brow.id);
        }
        projects.push({ projectId: row.id, bulletIds });
      }

      // ---- Skill rows + skills ------------------------------------------
      const skillRows: { skillRowId: string; skillIds: string[] }[] = [];
      for (const row of V1_SKILL_ROWS) {
        const rowRecord = one(
          await tx
            .insert(schema.technicalSkillRow)
            .values({
              name: row.name,
              top: row.top,
              separator: row.separator,
              userId: user.id,
            })
            .returning({ id: schema.technicalSkillRow.id }),
        );

        const skillIds: string[] = [];
        for (const skill of row.skills) {
          const skillRecord = one(
            await tx
              .insert(schema.technicalSkill)
              .values({ technicalSkillRowId: rowRecord.id, name: skill.name })
              .returning({ id: schema.technicalSkill.id }),
          );
          skillIds.push(skillRecord.id);
        }
        skillRows.push({ skillRowId: rowRecord.id, skillIds });
      }

      // ---- The Default resume --------------------------------------------
      const res = one(
        await tx
          .insert(schema.resume)
          .values({ name: 'Default', isDefault: true, templateId: tpl.id, userId: user.id })
          .returning({ id: schema.resume.id }),
      );

      // Select every experience + bullet, in reference order.
      for (const [i, exp] of experiences.entries()) {
        await tx
          .insert(schema.resumeExperience)
          .values({ resumeId: res.id, experienceId: exp.experienceId, sortOrder: i });
        for (const [j, bulletId] of exp.bulletIds.entries()) {
          await tx.insert(schema.resumeExperienceBullet).values({
            resumeId: res.id,
            experienceBulletId: bulletId,
            sortOrder: j,
          });
        }
      }

      // Select every project + bullet, in reference order.
      for (const [i, proj] of projects.entries()) {
        await tx
          .insert(schema.resumeProject)
          .values({ resumeId: res.id, projectId: proj.projectId, sortOrder: i });
        for (const [j, bulletId] of proj.bulletIds.entries()) {
          await tx.insert(schema.resumeProjectBullet).values({
            resumeId: res.id,
            projectBulletId: bulletId,
            sortOrder: j,
          });
        }
      }

      // Select every skill row + skill, in reference order.
      for (const [i, row] of skillRows.entries()) {
        await tx.insert(schema.resumeTechnicalSkillRow).values({
          resumeId: res.id,
          technicalSkillRowId: row.skillRowId,
          sortOrder: i,
        });
        for (const [j, skillId] of row.skillIds.entries()) {
          await tx.insert(schema.resumeTechnicalSkill).values({
            resumeId: res.id,
            technicalSkillId: skillId,
            sortOrder: j,
          });
        }
      }

      return {
        userId: user.id,
        templateId: tpl.id,
        resumeId: res.id,
        experienceCount: experiences.length,
        experienceBulletCount: experiences.reduce((n, e) => n + e.bulletIds.length, 0),
        projectCount: projects.length,
        projectBulletCount: projects.reduce((n, p) => n + p.bulletIds.length, 0),
        skillRowCount: skillRows.length,
        skillCount: skillRows.reduce((n, r) => n + r.skillIds.length, 0),
      };
    });

    console.log('Seed complete:');
    console.log(`  user: ${SEED_USER_EMAIL} (id ${summary.userId}) — owns everything below`);
    console.log(`  template: 1 (Default, id ${summary.templateId})`);
    console.log(
      `  experiences: ${summary.experienceCount} (${summary.experienceBulletCount} bullets)`,
    );
    console.log(`  projects: ${summary.projectCount} (${summary.projectBulletCount} bullets)`);
    console.log(
      `  technical skill rows: ${summary.skillRowCount} (${summary.skillCount} skills)`,
    );
    console.log(`  resume: 1 (Default, id ${summary.resumeId}), every item selected and ordered`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
