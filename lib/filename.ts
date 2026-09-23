/**
 * Download filenames for the two documents an application sends:
 * `<prefix>_<Company>_Resume.pdf` and `<prefix>_<Company>_Cover_Letter.pdf`.
 *
 * "Company" is the document's own `name` field (there is no separate company
 * column — see docs/SCHEMA.md, `resume_pdf.filename`), snake_cased with the
 * first letter of each word capitalized, regardless of how the user typed
 * it. Pure and synchronous: no I/O.
 */

const DEFAULT_PREFIX = 'Chris_Pyle';
const FALLBACK_WORD = 'Untitled';

/** Splits on runs of anything that isn't a Unicode letter or number, after
 * dropping apostrophes so contractions/possessives stay one word
 * ("O'Brien's" -> "OBriens", not "O" + "Briens"). */
function toWords(input: string): string[] {
  const cleaned = input.normalize('NFKC').replace(/['’]/g, '');
  return cleaned.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
}

/** Uppercases the first character, lowercases the rest — locale-aware so
 * accented letters capitalize sensibly too. */
function capitalizeWord(word: string): string {
  const first = word.slice(0, 1).toLocaleUpperCase();
  const rest = word.slice(1).toLocaleLowerCase();
  return `${first}${rest}`;
}

/** Snake-cases and title-cases arbitrary free text for use inside a filename. */
export function slugifyForFilename(input: string): string {
  const words = toWords(input).map(capitalizeWord);
  return words.length > 0 ? words.join('_') : FALLBACK_WORD;
}

/**
 * Builds `<prefix>_<Company>_<Kind>.pdf`. `prefix` defaults to
 * `PDF_NAME_PREFIX` (falling back to `Chris_Pyle`).
 *
 * The company portion is normalized by `slugifyForFilename`. The prefix is
 * operator-supplied rather than user-supplied, but it still ends up inside a
 * quoted `Content-Disposition` header, so quotes, control characters and CRLF
 * are stripped from it — a stray quote in the env var would otherwise truncate
 * the header value and break the download filename.
 */
function buildDocumentFilename(name: string, kind: string, prefix?: string): string {
  const raw = prefix ?? process.env.PDF_NAME_PREFIX ?? DEFAULT_PREFIX;
  const p = sanitizeForHeader(raw) || DEFAULT_PREFIX;
  return `${p}_${slugifyForFilename(name)}_${kind}.pdf`;
}

/** `<prefix>_<Company>_Resume.pdf`. */
export function buildResumeFilename(resumeName: string, prefix?: string): string {
  return buildDocumentFilename(resumeName, 'Resume', prefix);
}

/** `<prefix>_<Company>_Cover_Letter.pdf`, so the two documents an
 *  application sends sort next to each other in a downloads folder. */
export function buildCoverLetterFilename(coverLetterName: string, prefix?: string): string {
  return buildDocumentFilename(coverLetterName, 'Cover_Letter', prefix);
}

/** Strips quotes, backslashes and control characters (including CR/LF). */
export function sanitizeForHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/["\\]/g, '').replace(/[\x00-\x1f\x7f]/g, '');
}
