/**
 * `set_resume_selection`: chooses what an application's resume shows, then
 * compiles it and says whether it fits on one page (D-042).
 *
 * Every refusal happens before anything is written, and a refused call
 * writes nothing at all. Once the checks pass, all six slices go in one
 * transaction, and the compile comes after: a selection that runs long is
 * still saved, because the agent's next move is to trim it, not to start
 * over.
 */
import { z } from 'zod';
import { hasBeenSent } from '../../applications/status.ts';
import { compileTex, LatexServiceError } from '../../latex.ts';
import { setProposedSelection } from '../../queries/applications.ts';
import { assembleLibrary } from '../../queries/library.ts';
import { renderResumeById } from '../../queries/render.ts';
import { getResumeRow } from '../../queries/resumes.ts';
import { replaceSelections } from '../../queries/selections.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { suggestDrops } from '../overflow.ts';
import { findSelectionProblems, selectionInput, toSelections } from '../selection.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

export const setResumeSelection = defineTool({
  name: 'set_resume_selection',
  description:
    "Sets which experiences, projects, skill rows and their bullets and skills an application's " +
    'resume shows, in print order, replacing what it showed before, then compiles it. Take ids ' +
    'from get_library and pass all six fields. Returns JSON { ok, pages, overflow }: ok is true ' +
    'when the resume fits on one page. When it does not, overflow is { candidates, advice }, ' +
    'bullets to drop, best first; drop some and call again until ok is true. While the ' +
    'application is proposing, this is also recorded as your proposed selection.',
  input: z.strictObject({ application_id: z.uuid(), selection: selectionInput }),
  async run(ctx, args) {
    const app = await findLiveApplication(ctx.userId, args.application_id);
    if (!app) return noSuchApplication(args.application_id);

    // Refused only once sent: draft, proposing, needs_review and ready are all
    // still being tailored. Sending an edited ready application back to
    // review belongs to the approval flow (C3): `replaceSelections` does it,
    // for this tool and the editor alike (D-044).
    if (hasBeenSent(app.status)) {
      return toolError(
        `This application is ${app.status}: it has been sent, so its resume is no longer ` +
          'tailored here. Nothing was written. Leave it as it is, and call list_applications ' +
          'to find one that is still being tailored.',
      );
    }

    const resume = app.resumeId ? await getResumeRow(ctx.userId, app.resumeId) : null;
    if (!resume) {
      return toolError(
        'This application has no resume to select into. Nothing was written; ask Chris to link one.',
      );
    }
    // Default is what every new resume, and every application, is copied from.
    if (resume.isDefault) {
      return toolError(
        'This application is linked to the Default resume, which every new resume is copied ' +
          'from. Nothing was written; ask Chris to give it its own.',
      );
    }

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
    // A no-op once the application has left proposing (C7).
    await setProposedSelection(ctx.userId, app.id, selections);

    const { tex } = await renderResumeById(ctx.userId, resume.id);
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
      ok: compiled.pages === 1,
      pages: compiled.pages,
      overflow: suggestDrops(library, selections, compiled.pages),
    });
  },
});
