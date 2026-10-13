/**
 * Plain text as LaTeX that prints it. Text that arrives from outside LaTeX,
 * such as a cover letter's `body`, goes through here on its way into a
 * `.tex` (D-046).
 *
 * Never library content. Bullets, templates and a letter's `content` are
 * authored as LaTeX and substituted raw (D-008); escaping them would corrupt
 * every `\textbf{}` already written. This is for text whose author never
 * meant any of its characters as markup.
 *
 * The output is always inline. Every run of ASCII whitespace, newlines
 * included, becomes one space and the ends are trimmed, because a blank line
 * inside a macro argument (`\resumeItem{…}`) is a fatal error. Line and
 * paragraph structure is the caller's to build from lines it escapes one at
 * a time (`plainBodyToLatex`).
 *
 * Unicode passes through untouched: pdflatex reads UTF-8 by default, so
 * curly quotes, dashes, accents, `…` and non-breaking spaces print as
 * themselves. ASCII `"` passes through too and prints as a closing quote;
 * `\textquotedbl` would be the fix, but it does not exist in the OT1
 * encoding the repo's documents use and would break the compile.
 */

/**
 * Every character LaTeX reads as syntax, and what prints it instead.
 *
 * `< > |` are not syntax, but OT1, the default font encoding, prints them as
 * `¡ ¿ —`. The `{}` after a word-named command ends its name, so the letter
 * that follows (`\textbackslash{}n`) is not read as part of it.
 */
const SPECIALS: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
  '|': '\\textbar{}',
};

export function escapeLatex(text: string): string {
  return (
    text
      .replace(/[ \t\n\r\f\v]+/g, ' ')
      // Not `.trim()`, which would also strip a non-breaking space someone
      // put at an end on purpose: only the one ASCII space collapsing left.
      .replace(/^ | $/g, '')
      // One pass, so the braces a replacement inserts are never escaped again.
      .replace(/[\\{}$&#^_%~<>|]/g, (c) => SPECIALS[c] ?? c)
  );
}
