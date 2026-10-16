/**
 * Public entry point for the template render engine (T3).
 *
 * Pure and synchronous: no I/O, no DB imports. Given a template's raw LaTeX
 * and the library + selections it should be rendered against, produces the
 * fully substituted LaTeX plus any renderer-level warnings (dangling ids,
 * zero-bullet items, unknown tokens). Never throws on bad references — a
 * stale id must never break the whole preview.
 */
import type { BulletSuggestion, Library, Selections } from '../types.ts';
import { renderExperiences, renderProjects, renderSkills } from './sections.ts';
import { overlaySuggestions } from './suggestions.ts';
import { resolveConditionals, substituteTokens } from './tokens.ts';

export interface RenderResumeInput {
  templateContent: string;
  library: Library;
  selections: Selections;
  /** The agent's suggestions, laid over the bullets for a preview or a page
   *  count. Only pending ones count. Never passed for a snapshot (D-045). */
  suggestions?: readonly BulletSuggestion[];
}

export interface RenderResumeOutput {
  tex: string;
  warnings: string[];
}

export function renderResume({
  templateContent,
  library: stored,
  selections: chosen,
  suggestions = [],
}: RenderResumeInput): RenderResumeOutput {
  const warnings: string[] = [];
  const { library, selections } = overlaySuggestions(stored, chosen, suggestions, warnings);

  const experiences = renderExperiences(library, selections, warnings);
  const projects = renderProjects(library, selections, warnings);
  const skills = renderSkills(library, selections, warnings);

  const values = {
    EXPERIENCES: experiences,
    PROJECTS: projects,
    SKILLS_TOP: skills.top,
    SKILLS_BOTTOM: skills.bottom,
  };

  // Conditionals first: a section whose token is empty is dropped whole, so the
  // template's `\begin{itemize}` never survives without an `\item` (a fatal
  // LaTeX error, not a cosmetic one).
  const tex = substituteTokens(
    resolveConditionals(templateContent, values, warnings),
    values,
    warnings,
  );

  return { tex, warnings };
}

export { resolveConditionals, substituteTokens } from './tokens.ts';
export { renderExperiences, renderProjects, renderSkills } from './sections.ts';
