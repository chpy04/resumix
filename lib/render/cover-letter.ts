/**
 * A cover letter's `.tex`: its `content` as written, with its plain-text
 * `body`, when it has one, escaped and placed at the one `%%BODY%%` line
 * (D-046).
 *
 * Still no template and no tokens (D-035). The marker is a TeX comment, so a
 * letter with no body compiles exactly as written, marker and all, and a
 * letter written entirely in LaTeX never needs one. Only a letter that has a
 * body depends on it, which is why the query layer refuses to store a body
 * beside anything but exactly one marker line.
 *
 * Pure, like the rest of `lib/render`: the preview route and
 * `compileCoverLetterPdf` both build the `.tex` here.
 */
import { escapeLatex } from './escape.ts';

export const BODY_MARKER = '%%BODY%%';

/** A line holding only the marker: case-sensitive, with spaces or tabs
 *  around it allowed and a CRLF ending tolerated. The lookahead leaves the
 *  `\r` where it is. `% %%BODY%%` and `%%BODY%% x` are not markers. */
function markerLines(): RegExp {
  return /^[ \t]*%%BODY%%[ \t]*(?=\r?$)/gm;
}

/** Why `content` cannot take a body, or null when it has exactly one marker. */
export function bodyMarkerProblem(content: string): string | null {
  const count = content.match(markerLines())?.length ?? 0;
  if (count === 1) return null;
  if (count === 0) {
    return (
      `This letter has a body but no line holding only ${BODY_MARKER}, so its text has ` +
      'nowhere to go. Put that line where the text belongs.'
    );
  }
  return (
    `This letter has ${count} ${BODY_MARKER} lines; keep exactly one, on its own line ` +
    'where the text belongs.'
  );
}

/** Whether a letter is edited as plain text: it has a body, or a shell
 *  ready for one. A letter that is neither is LaTeX only, as letters were
 *  before D-046. */
export function takesPlainBody(letter: { content: string; body: string | null }): boolean {
  return letter.body !== null || bodyMarkerProblem(letter.content) === null;
}

/**
 * The body as LaTeX paragraphs. What you type is what prints: a blank line
 * starts a paragraph, and a single line break is kept, so a sign-off of
 * "Best," over "Chris" stays on two lines.
 *
 * The break is `\newline`, not `\\`: a `\\` followed by a line starting with
 * `[` reads that line as the break's optional length and aborts the compile,
 * and a body is free to start a line with anything.
 */
export function plainBodyToLatex(body: string): string {
  const paragraphs: string[][] = [[]];
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const escaped = escapeLatex(line);
    if (escaped) paragraphs[paragraphs.length - 1]?.push(escaped);
    // A blank line closes the paragraph; a run of them closes it once.
    else if (paragraphs[paragraphs.length - 1]?.length) paragraphs.push([]);
  }
  return paragraphs
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join('\\newline\n'))
    .join('\n\n');
}

export type CoverLetterTex = { ok: true; tex: string } | { ok: false; error: string };

export function coverLetterTex(content: string, body: string | null): CoverLetterTex {
  // Byte for byte, whatever its marker count: on its own the marker prints
  // nothing.
  if (body === null) return { ok: true, tex: content };

  const problem = bodyMarkerProblem(content);
  if (problem) return { ok: false, error: problem };

  const latex = plainBodyToLatex(body);
  // A replacer function, not a replacement string: escaped prose holds `\$`,
  // and a string would read `$'` or `$&` in it as part of the match.
  return { ok: true, tex: content.replace(markerLines(), () => latex) };
}
