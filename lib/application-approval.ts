/**
 * Final approval: the step that makes an application `ready` (C3, C4,
 * D-044).
 *
 * Three moves, in this order. The gate, which refuses unless every section
 * the page shows is approved. Both compiles, with nothing written yet, so a
 * LaTeX error or an unreachable sidecar leaves everything as it was. Then
 * one transaction that stores and pins the resume snapshot, stores the
 * letter's PDF, and sets `ready` (`recordFinalApproval`).
 *
 * Compiling first keeps a 25-second sidecar call out of the transaction.
 * The price is a window in which an edit can land, which the transaction's
 * guarded UPDATE catches.
 *
 * A compile failure is `{ ok: false }`, the same answer the other
 * application routes give, with each error prefixed by the document it came
 * from: approval compiles two.
 */
import { compileResumeForApplication } from './application-pdf.ts';
import { finalApprovalProblems } from './applications/review.ts';
import { compileCoverLetterPdf } from './cover-letter-pdf.ts';
import { LatexServiceError } from './latex.ts';
import { getApplicationRow, recordFinalApproval } from './queries/applications.ts';
import { countPendingSuggestions } from './queries/bullet-suggestions.ts';
import { getCoverLetterRow } from './queries/cover-letters.ts';
import { BadRequestError, NotFoundError } from './queries/errors.ts';
import type { ApplicationPdfResult } from './types.ts';

type Failure = Extract<ApplicationPdfResult, { ok: false }>;

/** Built field by field, so nothing beyond the documented shape reaches the
 *  response. */
function failure(
  document: 'Resume' | 'Cover letter',
  result: { pages: number | null; errors: string[]; warnings?: string[]; log: string },
): Failure {
  const errors = result.errors.length > 0 ? result.errors : ['it did not compile'];
  return {
    ok: false,
    pages: result.pages,
    errors: errors.map((error) => `${document}: ${error}`),
    warnings: result.warnings ?? [],
    log: result.log,
  };
}

export async function approveApplication(
  userId: string,
  id: string,
): Promise<ApplicationPdfResult> {
  const row = await getApplicationRow(userId, id);
  if (!row) throw new NotFoundError(`application ${id} not found`);

  const pendingSuggestions = await countPendingSuggestions(userId, id);
  const problems = finalApprovalProblems({ ...row, pendingSuggestions });
  // The gate guarantees a resume; the narrowing below is for the compiler.
  if (problems.length > 0 || !row.resumeId) throw new BadRequestError(problems.join(' '));

  const resume = await compileResumeForApplication(userId, {
    resumeId: row.resumeId,
    company: row.company,
  });
  if (!resume.ok) return failure('Resume', resume);

  let letter = null;
  if (row.coverLetterId) {
    const letterRow = await getCoverLetterRow(userId, row.coverLetterId);
    // The link is `on delete set null` and letters are never deleted.
    if (!letterRow) throw new Error(`application ${id} links a missing cover letter`);

    let compiled;
    try {
      compiled = await compileCoverLetterPdf(letterRow);
    } catch (err) {
      if (!(err instanceof LatexServiceError)) throw err;
      return failure('Cover letter', { pages: null, errors: [err.message], log: '' });
    }
    if (!compiled.ok) return failure('Cover letter', compiled);
    letter = { coverLetterId: letterRow.id, filename: compiled.filename, bytes: compiled.bytes };
  }

  const application = await recordFinalApproval(userId, id, {
    resumeId: row.resumeId,
    snapshot: resume.snapshot,
    letter,
  });
  return { ok: true, application };
}
