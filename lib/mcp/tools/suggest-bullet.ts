/**
 * `suggest_bullet`: the agent proposes a change to one bullet, which Chris
 * applies or rejects in review. It never writes to the library (D11, R2,
 * D-045): an edit names a bullet the resume shows and the text it would
 * read, an addition names an experience or project the resume shows and a
 * slot among its bullets.
 *
 * Every refusal happens before anything is written; the checks are
 * `lib/mcp/suggestion.ts`'s, shared with `suggest_resume_bullet`. Once
 * recorded, the resume is compiled with every pending suggestion laid
 * over it, so the page count is the one Chris's preview will show.
 */
import { z } from 'zod';
import { compileTex, LatexServiceError } from '../../latex.ts';
import { createBulletSuggestion, listBulletSuggestions } from '../../queries/bullet-suggestions.ts';
import { assembleLibrary } from '../../queries/library.ts';
import { renderResumeById } from '../../queries/render.ts';
import { getResumeRow } from '../../queries/resumes.ts';
import { getSelections } from '../../queries/selections.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { checkSuggestion, refineSuggestion, suggestionFields } from '../suggestion.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

const input = z
  .strictObject({ application_id: z.uuid(), ...suggestionFields })
  .superRefine(refineSuggestion);

export const suggestBullet = defineTool({
  name: 'suggest_bullet',
  description:
    "Proposes a change to one bullet on an application's resume, for Chris to apply or reject " +
    'in review; it never changes the library. kind edit rewrites a bullet the resume shows ' +
    '(bullet_id). kind add proposes a new bullet under an experience or project the resume ' +
    'shows (parent_id), at position among its bullets there. Write proposed_text as plain ' +
    'text, never LaTeX. Only while the application is proposing, so before submit_for_review. ' +
    'A second edit of the same bullet replaces the first. Returns JSON { suggestion_id, kind, ' +
    'replaced, ok, pages }: pages counts the resume with every pending suggestion applied, and ' +
    'ok is true on one page.',
  input,
  async run(ctx, args) {
    const app = await findLiveApplication(ctx.userId, args.application_id);
    if (!app) return noSuchApplication(args.application_id);

    // Suggest, then submit (the board's flow): once Chris has it, a new
    // suggestion would change what he is in the middle of reviewing.
    if (app.status !== 'proposing') {
      return toolError(
        `This application is ${app.status}; suggestions can only be made while it is ` +
          "proposing. Nothing was written. Put anything else you'd change in your reply to Chris.",
      );
    }

    const resume = app.resumeId ? await getResumeRow(ctx.userId, app.resumeId) : null;
    if (!resume) {
      return toolError(
        'This application has no resume to suggest bullets for. Nothing was written; ask Chris ' +
          'to link one.',
      );
    }
    if (resume.isDefault) {
      return toolError(
        'This application is linked to the Default resume, which every new resume is copied ' +
          'from. Nothing was written; ask Chris to give it its own.',
      );
    }

    // Live content only, as get_library shows it: an archived or another
    // user's id reads the same as an unknown one.
    const [library, selections, existing] = await Promise.all([
      assembleLibrary(ctx.userId, false),
      getSelections(resume.id),
      listBulletSuggestions(ctx.userId, app.id),
    ]);
    const suggestion = checkSuggestion(args, library, selections, existing, {
      resume: "this application's resume",
      selectTool: 'set_resume_selection',
    });
    if ('refusal' in suggestion) return toolError(suggestion.refusal);

    const { suggestion: saved, replaced } = await createBulletSuggestion(
      ctx.userId,
      app.id,
      suggestion,
    );

    const pending = await listBulletSuggestions(ctx.userId, app.id);
    const { tex } = await renderResumeById(ctx.userId, resume.id, undefined, pending);
    let compiled;
    try {
      compiled = await compileTex(tex);
    } catch (err) {
      if (!(err instanceof LatexServiceError)) throw err;
      return toolError(
        `The suggestion was saved as ${saved.id}, but Resumix could not compile the resume to ` +
          `count its pages (${err.message}). Nothing more is needed for this suggestion: ` +
          'submit_for_review counts the pages again. If that fails too, stop and tell Chris.',
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
      suggestion_id: saved.id,
      kind: saved.kind,
      replaced,
      ok: compiled.pages === 1,
      pages: compiled.pages,
    });
  },
});
