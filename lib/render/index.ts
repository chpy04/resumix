/**
 * Public entry point for the template render engine (T3).
 *
 * Pure and synchronous: no I/O, no DB imports. Given a template's raw LaTeX
 * and the library + selections it should be rendered against, produces the
 * fully substituted LaTeX plus any renderer-level warnings (dangling ids,
 * zero-bullet items, unknown tokens). Never throws on bad references — a
 * stale id must never break the whole preview.
 */
import type { Library, Selections } from '../types.ts';
import { renderExperiences, renderProjects, renderSkills } from './sections.ts';
import { substituteTokens } from './tokens.ts';

export interface RenderResumeInput {
  templateContent: string;
  library: Library;
  selections: Selections;
}

export interface RenderResumeOutput {
  tex: string;
  warnings: string[];
}

export function renderResume({
  templateContent,
  library,
  selections,
}: RenderResumeInput): RenderResumeOutput {
  const warnings: string[] = [];

  const experiences = renderExperiences(library, selections, warnings);
  const projects = renderProjects(library, selections, warnings);
  const skills = renderSkills(library, selections, warnings);

  const tex = substituteTokens(
    templateContent,
    {
      EXPERIENCES: experiences,
      PROJECTS: projects,
      SKILLS_TOP: skills.top,
      SKILLS_BOTTOM: skills.bottom,
    },
    warnings,
  );

  return { tex, warnings };
}

export { substituteTokens } from './tokens.ts';
export { renderExperiences, renderProjects, renderSkills } from './sections.ts';
