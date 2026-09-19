/**
 * The four token expansions from docs/TEMPLATE_TOKENS.md.
 *
 * `isArchived` is deliberately never consulted here. Archiving only hides
 * content from the picker UI; if a resume's Selections already reference an
 * id, it renders regardless of archive state (docs/DECISIONS.md D-011).
 */
import type { Bullet, Library, Selections } from '../types.ts';

function resolveBullets(
  ids: string[],
  bullets: Bullet[],
  where: string,
  warnings: string[],
): string[] {
  const resolved: string[] = [];
  for (const id of ids) {
    const bullet = bullets.find((b) => b.id === id);
    if (!bullet) {
      warnings.push(`${where}: no bullet with id "${id}" (dangling selection, skipped)`);
      continue;
    }
    resolved.push(bullet.content);
  }
  return resolved;
}

/** An empty `itemize` is a LaTeX error, so a zero-bullet item omits the block entirely. */
function bulletListBlock(bullets: string[]): string[] {
  if (bullets.length === 0) return [];
  return [
    '  \\resumeItemListStart{}',
    ...bullets.map((text) => `  \\resumeItem{${text}}`),
    '  \\resumeItemListEnd{}',
  ];
}

/** `<<EXPERIENCES>>`: selected experiences, in Selections order, each with its selected bullets. */
export function renderExperiences(
  library: Library,
  selections: Selections,
  warnings: string[],
): string {
  const blocks: string[] = [];
  for (const id of selections.experiences) {
    const experience = library.experiences.find((e) => e.id === id);
    if (!experience) {
      warnings.push(`experiences: no experience with id "${id}" (dangling selection, skipped)`);
      continue;
    }
    const bulletIds = selections.experienceBullets[id] ?? [];
    const bullets = resolveBullets(bulletIds, experience.bullets, `experiences/${id}`, warnings);
    if (bullets.length === 0) {
      warnings.push(
        `experiences/${id}: "${experience.title}" has no selected bullets — heading will render without a bullet list`,
      );
    }
    blocks.push(
      [
        `\\resumeSubheading{${experience.title}}`,
        `  {${experience.dateRange}}`,
        `  {${experience.company}}{${experience.location}}`,
        ...bulletListBlock(bullets),
      ].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

/** `<<PROJECTS>>`: selected projects, in Selections order, each with its selected bullets. */
export function renderProjects(
  library: Library,
  selections: Selections,
  warnings: string[],
): string {
  const blocks: string[] = [];
  for (const id of selections.projects) {
    const project = library.projects.find((p) => p.id === id);
    if (!project) {
      warnings.push(`projects: no project with id "${id}" (dangling selection, skipped)`);
      continue;
    }
    const bulletIds = selections.projectBullets[id] ?? [];
    const bullets = resolveBullets(bulletIds, project.bullets, `projects/${id}`, warnings);
    if (bullets.length === 0) {
      warnings.push(
        `projects/${id}: "${project.name}" has no selected bullets — heading will render without a bullet list`,
      );
    }
    blocks.push(
      [
        `\\resumeProjectHeading{${project.name}}`,
        `  {${project.technologies}}{${project.dateRange}}`,
        ...bulletListBlock(bullets),
      ].join('\n'),
    );
  }
  return blocks.join('\n\n');
}

/**
 * `<<SKILLS_TOP>>` / `<<SKILLS_BOTTOM>>`: selected skill rows split by their own
 * `top` flag, in Selections order within each half. Computed together so a
 * dangling row/skill id is only warned about once, and so a row lands in
 * exactly one of the two sections — whichever its own `top` flag says.
 */
export function renderSkills(
  library: Library,
  selections: Selections,
  warnings: string[],
): { top: string; bottom: string } {
  const topRows: string[] = [];
  const bottomRows: string[] = [];

  for (const id of selections.skillRows) {
    const row = library.skillRows.find((r) => r.id === id);
    if (!row) {
      warnings.push(`skillRows: no row with id "${id}" (dangling selection, skipped)`);
      continue;
    }
    const skillIds = selections.skills[id] ?? [];
    const names: string[] = [];
    for (const skillId of skillIds) {
      const skill = row.skills.find((s) => s.id === skillId);
      if (!skill) {
        warnings.push(
          `skillRows/${id}: no skill with id "${skillId}" (dangling selection, skipped)`,
        );
        continue;
      }
      names.push(skill.name);
    }
    if (names.length === 0) {
      warnings.push(`skillRows/${id}: "${row.name}" has no selected skills, row skipped`);
      continue;
    }
    const line = `\\textbf{${row.name}}{: ${names.join(row.separator)}}`;
    (row.top ? topRows : bottomRows).push(line);
  }

  return {
    top: topRows.join(' \\\\\n'),
    bottom: bottomRows.join(' \\\\\n'),
  };
}
