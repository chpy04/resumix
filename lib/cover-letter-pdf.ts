/**
 * Compiling a cover letter into the PDF that is downloaded, and that final
 * approval stores on the application (C4, D-044). One function, so "named
 * like the download" is one rule, and a change to how a letter is rendered
 * lands in both at once.
 *
 * A LaTeX error is `ok: false`, and so is a body with no `%%BODY%%` line to
 * go to, which the query layer never stores but a hand-edited row could hold
 * (D-046). An unreachable sidecar is not caught here: `LatexServiceError`
 * propagates, because the download answers it with a 502 and the approval
 * with its own message.
 */
import { buildCoverLetterFilename } from './filename.ts';
import { compileTex } from './latex.ts';
import { coverLetterTex } from './render/cover-letter.ts';

export type CompiledCoverLetter =
  | { ok: true; pages: number | null; filename: string; bytes: Buffer }
  | { ok: false; pages: number | null; errors: string[]; log: string };

export async function compileCoverLetterPdf(letter: {
  name: string;
  content: string;
  body: string | null;
}): Promise<CompiledCoverLetter> {
  const built = coverLetterTex(letter.content, letter.body);
  if (!built.ok) return { ok: false, pages: null, errors: [built.error], log: '' };

  const compiled = await compileTex(built.tex);
  if (!compiled.ok || !compiled.pdfBase64) {
    return { ok: false, pages: compiled.pages, errors: compiled.errors, log: compiled.log };
  }
  return {
    ok: true,
    pages: compiled.pages,
    filename: buildCoverLetterFilename(letter.name),
    bytes: Buffer.from(compiled.pdfBase64, 'base64'),
  };
}
