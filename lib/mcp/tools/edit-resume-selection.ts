/**
 * `edit_resume_selection`: chooses what one of Chris's own resumes shows,
 * saved straight onto it with no review, then compiles it and says whether
 * it fits on one page (D-054). Order and selection are the agent's to change
 * here; the text of a bullet is not, and goes through suggest_resume_bullet.
 *
 * As `set_resume_selection`: every refusal happens before anything is
 * written, all six slices go in one transaction, and a selection that runs
 * long is still saved, because the agent's next move is to trim it.
 */
import { z } from 'zod';
import { compileTex, LatexServiceError } from '../../latex.ts';
import { pendingResumeSuggestions } from '../../queries/bullet-suggestions.ts';
import { assembleLibrary } from '../../queries/library.ts';
import { renderResumeById } from '../../queries/render.ts';
import { replaceSelections } from '../../queries/selections.ts';
import { suggestDrops } from '../overflow.ts';
import { findOwnResume, resumeIdField } from '../resume.ts';
import { findSelectionProblems, selectionInput, toSelections } from '../selection.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

export const editResumeSelection = defineTool({
  name: 'edit_resume_selection',
  description:
    "Sets which experiences, projects, skill rows and their bullets and skills one of Chris's " +
    'own resumes shows, Default unless resume_id names another, in print order, replacing ' +
    'what it showed before, and saves it at once, then compiles it. Use it when Chris asks to ' +
    'reorder, add or drop content on his resume; to change what a bullet says, use ' +
    'suggest_resume_bullet. Call get_resume first and pass all six fields, with ids from ' +
    'get_library. Returns JSON { resume_id, ok, pages, overflow }: ok is true when it fits on ' +
    'one page; otherwise overflow is { candidates, advice }, bullets to drop, best first. For ' +
    "an application's resume, use set_resume_selection.",
  input: z.strictObject({ resume_id: resumeIdField, selection: selectionInput }),
  async run(ctx, args) {
    const found = await findOwnResume(ctx.userId, args.resume_id);
    if ('error' in found) return found.error;
    const { resume } = found;

    const library = await assembleLibrary(ctx.userId, false);
    const problems = findSelectionProblems(library, args.selection);
    if (problems.length > 0) {
      return toolError(
        `Nothing was written: ${problems.join('; ')}. Call get_library for current ids, fix ` +
          'these and call again.',
      );
    }

    const selections = toSelections(args.selection);
    await replaceSelections(ctx.userId, resume.id, selections);

    // Counted with any pending suggestion applied, as Chris's preview in the
    // editor will show it.
    const suggestions = await pendingResumeSuggestions(ctx.userId, resume.id);
    const { tex } = await renderResumeById(ctx.userId, resume.id, undefined, suggestions);
    let compiled;
    try {
      compiled = await compileTex(tex);
    } catch (err) {
      if (!(err instanceof LatexServiceError)) throw err;
      return toolError(
        `The selection was saved, but Resumix could not compile it (${err.message}). Call ` +
          'again with the same arguments in a minute; if it fails again, stop and tell Chris.',
      );
    }

    if (!compiled.ok || compiled.pages === null) {
      const errors = compiled.errors.slice(0, 3).join(' | ') || 'no page count came back';
      return toolError(
        `Saved, but it does not compile: ${errors}. Undo your last change and call again; if ` +
          'it still fails, tell Chris.',
      );
    }

    return toolJson({
      resume_id: resume.id,
      ok: compiled.pages === 1,
      pages: compiled.pages,
      overflow: suggestDrops(library, selections, compiled.pages),
    });
  },
});
