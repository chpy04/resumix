/**
 * `submit_for_review`: the agent's last call on an application. It hands the
 * application to Chris, moving `proposing` to `needs_review`, but only while
 * the resume and the cover letter (if there is one) each fit on one page
 * (C3, D-044).
 *
 * Both are compiled here, now, rather than trusting an earlier
 * `set_resume_selection` answer: the letter has no such tool, and the resume
 * may have changed since. Every refusal writes nothing. Calling it again on
 * one already in review re-checks the pages and leaves it there.
 */
import { z } from 'zod';
import { compileResumeForApplication } from '../../application-pdf.ts';
import { compileCoverLetterPdf } from '../../cover-letter-pdf.ts';
import { LatexServiceError } from '../../latex.ts';
import { submitForReview as submitApplication } from '../../queries/applications.ts';
import { getCoverLetterRow } from '../../queries/cover-letters.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { defineTool, toolError, toolJson, type ToolResult } from '../tool.ts';

type Document = 'resume' | 'cover letter';

function doesNotCompile(document: Document, errors: string[]): ToolResult {
  const first = errors.slice(0, 3).join(' | ') || 'no page count came back';
  return toolError(
    `The ${document} does not compile: ${first}. Nothing was submitted. Stop and tell Chris.`,
  );
}

function unreachable(document: Document, message: string): ToolResult {
  return toolError(
    `Resumix could not compile the ${document} to count its pages (${message}). Nothing was ` +
      'submitted. Call again in a minute; if it fails again, stop and tell Chris.',
  );
}

export const submitForReview = defineTool({
  name: 'submit_for_review',
  description:
    'Hands an application to Chris for review, moving it from proposing to needs_review. Call ' +
    'it last, once set_resume_selection has answered ok: true. Resumix compiles the resume, and ' +
    'the cover letter if the application has one, and refuses while either is more than one ' +
    'page. Returns JSON { application_id, status, resume_pages, cover_letter_pages }; ' +
    'cover_letter_pages is null when there is no letter.',
  input: z.strictObject({ application_id: z.uuid() }),
  async run(ctx, args) {
    const app = await findLiveApplication(ctx.userId, args.application_id);
    if (!app) return noSuchApplication(args.application_id);

    if (app.status === 'ready') {
      return toolError(
        'This application is ready: Chris has approved it, so there is nothing to submit. ' +
          'Nothing was changed.',
      );
    }
    if (app.status !== 'proposing' && app.status !== 'needs_review') {
      return toolError(
        `This application is ${app.status}, not one you are proposing, so it can't be ` +
          'submitted for review. Nothing was changed.',
      );
    }
    if (!app.resumeId) {
      return toolError(
        'This application has no resume. Nothing was submitted; ask Chris to link one.',
      );
    }

    const resume = await compileResumeForApplication(ctx.userId, {
      resumeId: app.resumeId,
      company: app.company,
    });
    if (!resume.ok) {
      return resume.unavailable
        ? unreachable('resume', resume.errors[0] ?? 'no reason given')
        : doesNotCompile('resume', resume.errors);
    }
    if (resume.pages === null) return doesNotCompile('resume', []);
    if (resume.pages > 1) {
      return toolError(
        `The resume is ${resume.pages} pages; it must be one. Nothing was submitted. Call ` +
          'set_resume_selection with fewer bullets (its overflow lists what to drop first), ' +
          'then call submit_for_review again.',
      );
    }

    let letterPages: number | null = null;
    if (app.coverLetterId) {
      const letter = await getCoverLetterRow(ctx.userId, app.coverLetterId);
      // The link is `on delete set null` and letters are never deleted.
      if (!letter) throw new Error(`application ${app.id} links a missing cover letter`);

      let compiled;
      try {
        compiled = await compileCoverLetterPdf(letter);
      } catch (err) {
        if (!(err instanceof LatexServiceError)) throw err;
        return unreachable('cover letter', err.message);
      }
      if (!compiled.ok) return doesNotCompile('cover letter', compiled.errors);
      if (compiled.pages === null) return doesNotCompile('cover letter', []);
      if (compiled.pages > 1) {
        return toolError(
          `The cover letter is ${compiled.pages} pages; it must be one. Nothing was submitted. ` +
            "Shorten it, then call submit_for_review again; if you can't edit it, stop and " +
            'tell Chris.',
        );
      }
      letterPages = compiled.pages;
    }

    // The status is re-checked in the UPDATE: Chris may have moved it while
    // the documents compiled.
    if (!(await submitApplication(ctx.userId, app.id))) {
      return toolError(
        'This application changed while it was being checked, so nothing was submitted. Call ' +
          'get_application to see where it stands.',
      );
    }

    return toolJson({
      application_id: app.id,
      status: 'needs_review',
      resume_pages: resume.pages,
      cover_letter_pages: letterPages,
    });
  },
});
