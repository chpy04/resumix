/**
 * End-to-end smoke test for T5 (the project's stated acceptance bar: "I
 * should always be able to represent my current resume within the
 * project").
 *
 * Reads the seeded "Default" resume back out of the database exactly as an
 * API handler would (template content, full Library, and that resume's
 * Selections built from the bridge tables' sort_order), renders it with
 * `renderResume()` from `lib/render`, diffs the result against
 * `docs/reference/v1-resume.tex` (normalizing insignificant whitespace, same
 * as `lib/render/render.test.ts`'s round-trip test), and finally POSTs the
 * rendered `.tex` to the sidecar latex service and asserts it compiles to
 * exactly one page.
 *
 * This does not modify the database — read-only.
 *
 * Usage:
 *   DATABASE_URL=... LATEX_SERVICE_URL=http://localhost:8080 \
 *     node --experimental-strip-types scripts/smoke.ts
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../lib/db/schema.ts';
import { renderResume } from '../lib/render/index.ts';
import { compileTex } from '../lib/latex.ts';
import type { Library, Selections } from '../lib/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const referencePath = join(__dirname, '..', 'docs', 'reference', 'v1-resume.tex');
const scratchDir = join(__dirname, '.scratch');

/**
 * Collapses whitespace that has no effect on the compiled LaTeX output.
 * Copied from lib/render/render.test.ts's round-trip test so the smoke test
 * applies the exact same normalization; kept in sync by inspection since
 * this script intentionally does not import a test file.
 */
function normalizeInsignificantWhitespace(tex: string): string {
  return tex
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .trim();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema });

  try {
    // ---- Load the Default resume + its template ------------------------
    const resumeRow = (
      await db.select().from(schema.resume).where(eq(schema.resume.isDefault, true)).limit(1)
    )[0];
    if (!resumeRow) {
      throw new Error('No default resume found — run scripts/seed.ts first.');
    }

    const templateRow = (
      await db
        .select()
        .from(schema.template)
        .where(eq(schema.template.id, resumeRow.templateId))
        .limit(1)
    )[0];
    if (!templateRow) {
      throw new Error(`Resume ${resumeRow.id} references a missing template ${resumeRow.templateId}`);
    }

    // ---- Load the full Library (every content row, archived or not) ----
    const experienceRows = await db.select().from(schema.experience);
    const experienceBulletRows = await db.select().from(schema.experienceBullet);
    const projectRows = await db.select().from(schema.project);
    const projectBulletRows = await db.select().from(schema.projectBullet);
    const skillRowRows = await db.select().from(schema.technicalSkillRow);
    const skillRows_ = await db.select().from(schema.technicalSkill);

    const library: Library = {
      experiences: experienceRows.map((e) => ({
        id: e.id,
        company: e.company,
        title: e.title,
        dateRange: e.dateRange,
        location: e.location,
        isArchived: e.isArchived,
        bullets: experienceBulletRows
          .filter((b) => b.experienceId === e.id)
          .map((b) => ({ id: b.id, content: b.content, isArchived: b.isArchived })),
      })),
      projects: projectRows.map((p) => ({
        id: p.id,
        name: p.name,
        technologies: p.technologies,
        dateRange: p.dateRange,
        isArchived: p.isArchived,
        bullets: projectBulletRows
          .filter((b) => b.projectId === p.id)
          .map((b) => ({ id: b.id, content: b.content, isArchived: b.isArchived })),
      })),
      skillRows: skillRowRows.map((r) => ({
        id: r.id,
        name: r.name,
        top: r.top,
        separator: r.separator,
        isArchived: r.isArchived,
        skills: skillRows_
          .filter((s) => s.technicalSkillRowId === r.id)
          .map((s) => ({ id: s.id, name: s.name, isArchived: s.isArchived })),
      })),
      templates: [
        {
          id: templateRow.id,
          name: templateRow.name,
          content: templateRow.content,
          isDefault: templateRow.isDefault,
          isArchived: templateRow.isArchived,
        },
      ],
    };

    // ---- Load this resume's Selections from the bridge tables ----------
    const resumeExperienceRows = await db
      .select()
      .from(schema.resumeExperience)
      .where(eq(schema.resumeExperience.resumeId, resumeRow.id))
      .orderBy(asc(schema.resumeExperience.sortOrder));
    const resumeExperienceBulletRows = await db
      .select()
      .from(schema.resumeExperienceBullet)
      .where(eq(schema.resumeExperienceBullet.resumeId, resumeRow.id))
      .orderBy(asc(schema.resumeExperienceBullet.sortOrder));
    const resumeProjectRows = await db
      .select()
      .from(schema.resumeProject)
      .where(eq(schema.resumeProject.resumeId, resumeRow.id))
      .orderBy(asc(schema.resumeProject.sortOrder));
    const resumeProjectBulletRows = await db
      .select()
      .from(schema.resumeProjectBullet)
      .where(eq(schema.resumeProjectBullet.resumeId, resumeRow.id))
      .orderBy(asc(schema.resumeProjectBullet.sortOrder));
    const resumeSkillRowRows = await db
      .select()
      .from(schema.resumeTechnicalSkillRow)
      .where(eq(schema.resumeTechnicalSkillRow.resumeId, resumeRow.id))
      .orderBy(asc(schema.resumeTechnicalSkillRow.sortOrder));
    const resumeSkillRows_ = await db
      .select()
      .from(schema.resumeTechnicalSkill)
      .where(eq(schema.resumeTechnicalSkill.resumeId, resumeRow.id))
      .orderBy(asc(schema.resumeTechnicalSkill.sortOrder));

    // experienceBulletId -> experienceId, to bucket resumeExperienceBullet rows per experience.
    const experienceIdOfBullet = new Map(experienceBulletRows.map((b) => [b.id, b.experienceId]));
    const projectIdOfBullet = new Map(projectBulletRows.map((b) => [b.id, b.projectId]));
    const skillRowIdOfSkill = new Map(skillRows_.map((s) => [s.id, s.technicalSkillRowId]));

    const experienceBullets: Record<string, string[]> = {};
    for (const row of resumeExperienceBulletRows) {
      const experienceId = experienceIdOfBullet.get(row.experienceBulletId);
      if (!experienceId) continue; // dangling; renderer will warn if this ever happens
      (experienceBullets[experienceId] ??= []).push(row.experienceBulletId);
    }

    const projectBullets: Record<string, string[]> = {};
    for (const row of resumeProjectBulletRows) {
      const projectId = projectIdOfBullet.get(row.projectBulletId);
      if (!projectId) continue;
      (projectBullets[projectId] ??= []).push(row.projectBulletId);
    }

    const skills: Record<string, string[]> = {};
    for (const row of resumeSkillRows_) {
      const skillRowId = skillRowIdOfSkill.get(row.technicalSkillId);
      if (!skillRowId) continue;
      (skills[skillRowId] ??= []).push(row.technicalSkillId);
    }

    const selections: Selections = {
      experiences: resumeExperienceRows.map((r) => r.experienceId),
      experienceBullets,
      projects: resumeProjectRows.map((r) => r.projectId),
      projectBullets,
      skillRows: resumeSkillRowRows.map((r) => r.technicalSkillRowId),
      skills,
    };

    // ---- Render ----------------------------------------------------------
    const { tex, warnings } = renderResume({
      templateContent: templateRow.content,
      library,
      selections,
    });

    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, 'smoke-rendered.tex'), tex);

    console.log(`Loaded resume "${resumeRow.name}" (${resumeRow.id})`);
    console.log(`Template: "${templateRow.name}" (${templateRow.id})`);
    console.log(`Selections: ${selections.experiences.length} experiences, ${selections.projects.length} projects, ${selections.skillRows.length} skill rows`);
    console.log(`Render warnings: ${warnings.length === 0 ? 'none' : JSON.stringify(warnings)}`);

    // ---- Compare against the reference file -----------------------------
    const referenceRaw = readFileSync(referencePath, 'utf8');

    // Documented divergence: the reference has a commented-out placeholder
    // bullet in Experience #1's item list. LaTeX comments are inert, and the
    // render engine has no concept of "a comment living inside token-owned
    // content" (the whole bullet list is data-driven), so this line cannot
    // and should not be reproduced. lib/render/render.test.ts documents and
    // strips the exact same line; we do the same here.
    const documentedDivergence =
      '  % \\resumeItem{Built \\textbf{AWS} infrastructure (EC2, RDS, S3) using \\textbf{Terraform} and automated deployments with \\textbf{CI/CD pipeline}}\n';
    if (!referenceRaw.includes(documentedDivergence)) {
      throw new Error('expected reference file to still contain the documented divergence line -- has v1-resume.tex changed?');
    }
    const referenceAdjusted = referenceRaw.replace(documentedDivergence, '');

    const normalizedActual = normalizeInsignificantWhitespace(tex);
    const normalizedExpected = normalizeInsignificantWhitespace(referenceAdjusted);

    let roundTripOk = normalizedActual === normalizedExpected;
    if (!roundTripOk) {
      const actualPath = join(scratchDir, 'smoke-normalized-actual.tex');
      const expectedPath = join(scratchDir, 'smoke-normalized-expected.tex');
      writeFileSync(actualPath, normalizedActual);
      writeFileSync(expectedPath, normalizedExpected);
      let diffOutput = '';
      try {
        execFileSync('diff', ['-u', expectedPath, actualPath], { encoding: 'utf8' });
      } catch (err) {
        diffOutput = (err as { stdout?: string }).stdout ?? String(err);
      }
      console.log('--- ROUND TRIP DIFF (expected vs actual, normalized) ---');
      console.log(diffOutput);
    } else {
      console.log('Round trip: rendered output matches docs/reference/v1-resume.tex (modulo insignificant whitespace and the documented divergence).');
    }

    // ---- Compile the rendered tex ----------------------------------------
    console.log('Compiling rendered tex via the latex service...');
    const compileResult = await compileTex(tex);
    console.log(`Compile result: ok=${compileResult.ok} pages=${compileResult.pages} durationMs=${compileResult.durationMs}`);
    if (!compileResult.ok) {
      console.log('Errors:', JSON.stringify(compileResult.errors, null, 2));
    }

    const compileOk = compileResult.ok === true && compileResult.pages === 1;

    console.log('');
    console.log('=== SMOKE TEST SUMMARY ===');
    console.log(`Round trip match: ${roundTripOk ? 'PASS' : 'FAIL'}`);
    console.log(`Compile ok + 1 page: ${compileOk ? 'PASS' : 'FAIL'} (ok=${compileResult.ok}, pages=${compileResult.pages})`);

    if (!roundTripOk || !compileOk) {
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
