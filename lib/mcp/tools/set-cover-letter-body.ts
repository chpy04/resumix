/**
 * `set_cover_letter_body`: writes an application's cover letter as plain
 * text, then compiles it and says whether it fits on one page (D-046).
 *
 * The agent never writes LaTeX. Its text becomes the letter's `body`, which
 * Resumix escapes into the `%%BODY%%` line of a letter copied from Chris's
 * Default, so the design is his and only the prose is the agent's. With no
 * letter linked, this first copies Default onto the application, as "Add a
 * cover letter" does (C12).
 *
 * Every refusal happens before anything is written, Default's marker
 * included, so a refused call creates no letter. Attaching the letter and
 * writing the body are two writes, not one transaction: a call that fails
 * between them leaves a linked copy of Default, which the next call writes
 * into. A letter over one page is still saved, as an overlong selection is,
 * because the agent's next move is to shorten it.
 */
import { z } from 'zod';
import { hasBeenSent } from '../../applications/status.ts';
import { compileCoverLetterPdf } from '../../cover-letter-pdf.ts';
import { LatexServiceError } from '../../latex.ts';
import { attachCoverLetter } from '../../queries/applications.ts';
import {
  getCoverLetterRow,
  getDefaultCoverLetter,
  updateCoverLetter,
} from '../../queries/cover-letters.ts';
import { bodyMarkerProblem } from '../../render/cover-letter.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

export const setCoverLetterBody = defineTool({
  name: 'set_cover_letter_body',
  description:
    "Writes an application's cover letter as plain text, then compiles it. Call it only when " +
    'the application form asks for a cover letter file; a cover letter text box on the form is ' +
    'a question, not this. Pass the whole letter, from the salutation to the sign-off: a blank ' +
    'line starts a paragraph, and a single line break is kept. Write plain text, never LaTeX, ' +
    'with curly quotes (“ ” ‘ ’) rather than straight ones; Resumix escapes it and lays it out ' +
    "in Chris's Default letter's design. Each call replaces the letter's text, and an " +
    'application with no letter is first given one copied from Default. Returns JSON ' +
    '{ ok, pages }: ok is true when the letter fits on one page; when it does not, shorten the ' +
    'text and call again.',
  input: z.strictObject({ application_id: z.uuid(), text: z.string().trim().min(1) }),
  async run(ctx, args) {
    const app = await findLiveApplication(ctx.userId, args.application_id);
    if (!app) return noSuchApplication(args.application_id);

    // Refused only once sent, as `set_resume_selection` is. Sending an
    // edited ready application back to review is `updateCoverLetter`'s job
    // (C3, D-044).
    if (hasBeenSent(app.status)) {
      return toolError(
        `This application is ${app.status}: it has been sent, so its cover letter is no ` +
          'longer drafted here. Nothing was written. Leave it as it is.',
      );
    }

    if (app.coverLetterId) {
      const letter = await getCoverLetterRow(ctx.userId, app.coverLetterId);
      // The link is `on delete set null` and letters are never deleted.
      if (!letter) throw new Error(`application ${app.id} links a missing cover letter`);
      // Default is what every new letter is copied from.
      if (letter.isDefault) {
        return toolError(
          'This application is linked to the Default cover letter, which every new letter is ' +
            'copied from. Nothing was written; ask Chris to give it its own.',
        );
      }
      if (bodyMarkerProblem(letter.content)) {
        return toolError(
          `This application's cover letter (${letter.name}) has no line holding only %%BODY%% ` +
            '(or more than one), so the text would have nowhere to go. Nothing was written. ' +
            'Stop and tell Chris to put one in that letter, and in his Default letter, where ' +
            'the text should go, then call again.',
        );
      }
    } else {
      // Checked before copying, so a refusal leaves no letter behind. With
      // no Default at all, the copy falls back to the built-in shell, which
      // has its marker.
      const fallback = await getDefaultCoverLetter(ctx.userId);
      if (fallback && bodyMarkerProblem(fallback.content)) {
        return toolError(
          "Chris's Default cover letter has no line holding only %%BODY%% (or more than " +
            'one), so a new letter would have nowhere to put the text. Nothing was written. ' +
            'Stop and tell Chris to put one in his Default letter where the text should go, ' +
            'then call again.',
        );
      }
    }

    const letterId =
      app.coverLetterId ?? (await attachCoverLetter(ctx.userId, app.id)).coverLetterId;
    if (!letterId) throw new Error(`application ${app.id} has no letter after attaching one`);
    const letter = await updateCoverLetter(ctx.userId, letterId, { body: args.text });

    let compiled;
    try {
      compiled = await compileCoverLetterPdf(letter);
    } catch (err) {
      if (!(err instanceof LatexServiceError)) throw err;
      return toolError(
        `The text was saved, but Resumix could not compile it (${err.message}). Call again ` +
          'with the same text in a minute; if it fails again, stop and tell Chris.',
      );
    }

    if (!compiled.ok || compiled.pages === null) {
      const failed = compiled.ok ? [] : compiled.errors;
      const errors = failed.slice(0, 3).join(' | ') || 'no page count came back';
      return toolError(
        `The text was saved, but the letter does not compile: ${errors}. Remove any emoji or ` +
          'non-Latin characters and call again; if it still fails, stop and tell Chris.',
      );
    }

    return toolJson({ ok: compiled.pages === 1, pages: compiled.pages });
  },
});
