/**
 * `get_resume`: one of Chris's own resumes as the agent needs it to change
 * it (D-054): what it shows now, and what it suggested and what became of
 * each suggestion.
 */
import { z } from 'zod';
import { listResumeSuggestions } from '../../queries/bullet-suggestions.ts';
import { getSelections } from '../../queries/selections.ts';
import { editorPath, findOwnResume, resumeIdField } from '../resume.ts';
import { fromSelections } from '../selection.ts';
import { defineTool, toolJson } from '../tool.ts';

export const getResume = defineTool({
  name: 'get_resume',
  description:
    "Returns one of Chris's own resumes, Default unless resume_id names another, as JSON { " +
    'resume_id, name, is_default, editor_path, selection, bullet_suggestions }. selection is ' +
    'what it shows now, in the shape edit_resume_selection takes; pair its ids with ' +
    'get_library for the text. bullet_suggestions is every suggest_resume_bullet call kept on ' +
    'it, oldest first, with its status: pending, applied, copied (saved as a new bullet) or ' +
    'rejected. editor_path is where Chris reviews the pending ones. Call it before changing ' +
    'a resume.',
  input: z.strictObject({ resume_id: resumeIdField }),
  async run(ctx, args) {
    const found = await findOwnResume(ctx.userId, args.resume_id);
    if ('error' in found) return found.error;
    const { resume } = found;
    const [selections, suggestions] = await Promise.all([
      getSelections(resume.id),
      listResumeSuggestions(ctx.userId, resume.id),
    ]);
    return toolJson({
      resume_id: resume.id,
      name: resume.name,
      is_default: resume.isDefault,
      editor_path: editorPath(resume.id),
      selection: fromSelections(selections),
      // So the agent can see what Chris did with each, and not suggest one
      // twice.
      bullet_suggestions: suggestions.map((s) => ({
        suggestion_id: s.id,
        kind: s.kind,
        bullet_id: s.bulletId,
        parent_id: s.parentId,
        position: s.position,
        proposed_text: s.proposedText,
        rationale: s.rationale,
        status: s.status,
      })),
    });
  },
});
