/**
 * Assembles the inputs to `renderResume` (T3) for a given resume: its
 * template (or an unsaved override), its Selections, and the full Library.
 * Pure DB reads — no LaTeX compilation here (see app/api/resumes/[id]/render
 * and .../pdf, which call `compileTex` after this).
 */
import type { RenderResumeOutput } from '../render/index.ts';
import { renderResume } from '../render/index.ts';
import { NotFoundError } from './errors.ts';
import { assembleLibrary } from './library.ts';
import { getResumeRow } from './resumes.ts';
import { getSelections } from './selections.ts';
import { getTemplateById } from './templates.ts';

export async function renderResumeById(
  resumeId: string,
  templateOverride?: string,
): Promise<RenderResumeOutput> {
  const resumeRow = await getResumeRow(resumeId);
  if (!resumeRow) throw new NotFoundError(`resume ${resumeId} not found`);

  let templateContent = templateOverride;
  if (templateContent === undefined) {
    const template = await getTemplateById(resumeRow.templateId);
    if (!template) {
      throw new Error(`resume ${resumeId} references missing template ${resumeRow.templateId}`);
    }
    templateContent = template.content;
  }

  const [selections, library] = await Promise.all([
    getSelections(resumeId),
    assembleLibrary(true),
  ]);

  return renderResume({ templateContent, library, selections });
}
