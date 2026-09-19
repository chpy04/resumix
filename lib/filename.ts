/**
 * Download filename for a resume PDF: `<prefix>_<Company>_Resume.pdf`.
 *
 * "Company" is the resume's own `name` field (there is no separate company
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
 * Builds `<prefix>_<Company>_Resume.pdf`. `prefix` defaults to
 * `PDF_NAME_PREFIX` (falling back to `Chris_Pyle`) and is used verbatim —
 * only the company portion is normalized.
 */
export function buildResumeFilename(resumeName: string, prefix?: string): string {
  const p = prefix ?? process.env.PDF_NAME_PREFIX ?? DEFAULT_PREFIX;
  return `${p}_${slugifyForFilename(resumeName)}_Resume.pdf`;
}
