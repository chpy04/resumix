/**
 * `suggest_resume_bullet`: the agent proposes a change to one bullet's text
 * on one of Chris's own resumes (D-054). It never writes to the library or
 * the resume (D11, R2, D-045): the suggestion is a card in that resume's
 * editor, where Chris rewords it if he likes and applies or rejects it.
 *
 * The checks are `suggest_bullet`'s (`lib/mcp/suggestion.ts`), and every
 * refusal happens before anything is written. Once recorded, the resume is
 * compiled with every pending suggestion laid over it, so the page count is
 * the one Chris's preview will show.
 */
import { z } from 'zod';
import { compileTex, LatexServiceError } from '../../latex.ts';
import {
  createResumeSuggestion,
  listResumeSuggestions,
  pendingResumeSuggestions,
} from '../../queries/bullet-suggestions.ts';
import { assembleLibrary } from '../../queries/library.ts';
import { renderResumeById } from '../../queries/render.ts';
import { getSelections } from '../../queries/selections.ts';
import { editorPath, findOwnResume, resumeIdField } from '../resume.ts';
import { checkSuggestion, refineSuggestion, suggestionFields } from '../suggestion.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

const input = z
  .strictObject({ resume_id: resumeIdField, ...suggestionFields })
  .superRefine(refineSuggestion);

export const suggestResumeBullet = defineTool({
  name: 'suggest_resume_bullet',
  description:
    "Proposes a change to one bullet's text on one of Chris's own resumes, Default unless " +
    'resume_id names another. It never changes the library or the resume: Chris sees it as ' +
    "a card in that resume's editor, at editor_path, where he can reword it and then apply " +
    'or reject it. kind edit rewrites a bullet the resume shows (bullet_id). kind add ' +
    'proposes a new bullet under an experience or project the resume shows (parent_id), at ' +
    'position among its bullets there. Write proposed_text as plain text, never LaTeX. A ' +
    "second edit of the same bullet replaces the pending one, Chris's rewording included. " +
    'Returns JSON { resume_id, suggestion_id, kind, replaced, ok, pages, editor_path }: pages ' +
    'counts the resume with every pending suggestion applied, and ok is true on one page. ' +
    "For an application's resume, use suggest_bullet.",
  input,
  async run(ctx, args) {
    const found = await findOwnResume(ctx.userId, args.resume_id);
    if ('error' in found) return found.error;
    const { resume } = found;

    // Live content only, as get_library shows it: an archived or another
    // user's id reads the same as an unknown one.
    const [library, selections, existing] = await Promise.all([
      assembleLibrary(ctx.userId, false),
      getSelections(resume.id),
      listResumeSuggestions(ctx.userId, resume.id),
    ]);
    const suggestion = checkSuggestion(args, library, selections, existing, {
      resume: 'this resume',
      selectTool: 'edit_resume_selection',
    });
    if ('refusal' in suggestion) return toolError(suggestion.refusal);

    const { suggestion: saved, replaced } = await createResumeSuggestion(
      ctx.userId,
      resume.id,
      suggestion,
    );

    const pending = await pendingResumeSuggestions(ctx.userId, resume.id);
    const { tex } = await renderResumeById(ctx.userId, resume.id, undefined, pending);
    let compiled;
    try {
      compiled = await compileTex(tex);
    } catch (err) {
      if (!(err instanceof LatexServiceError)) throw err;
      return toolError(
        `The suggestion was saved as ${saved.id}, but Resumix could not compile the resume to ` +
          `count its pages (${err.message}). Nothing more is needed for this suggestion; if ` +
          'the next call fails the same way, stop and tell Chris.',
      );
    }
    if (!compiled.ok || compiled.pages === null) {
      const errors = compiled.errors.slice(0, 3).join(' | ') || 'no page count came back';
      return toolError(
        `The suggestion was saved as ${saved.id}, but the resume no longer compiles with it: ` +
          `${errors}. Stop and tell Chris.`,
      );
    }

    return toolJson({
      resume_id: resume.id,
      suggestion_id: saved.id,
      kind: saved.kind,
      replaced,
      ok: compiled.pages === 1,
      pages: compiled.pages,
      editor_path: editorPath(resume.id),
    });
  },
});
