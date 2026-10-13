/**
 * Raw LaTeX content as the text it prints, for a reader who should not have
 * to parse LaTeX: the agent, which works in plain text while Resumix owns the
 * LaTeX (D-042).
 *
 * Display only. The result is never stored and never handed to the renderer,
 * so whatever it drops is dropped from a copy: the content itself stays raw
 * and unescaped (D-008). It is deliberately small, covering what the library
 * holds (`\textbf{}`, `\href{}{\underline{}}`, `\$`, `$|$`), not LaTeX at
 * large.
 */

/** Typed escaped (`\$`) because LaTeX would otherwise read them as syntax. */
const ESCAPED = new Set(['$', '&', '%', '#', '_']);

/** Control symbols that print as a gap: a line break, a forced space, a
 *  thin space. Every other one (`\-`, `\/`, …) prints nothing. */
const SPACING = new Set(['\\', ' ', ',']);

/** The index of the `}` closing the `{` at `open`, or the end of the string
 *  when it is never closed. An escaped brace does not count. */
function closingBrace(latex: string, open: number): number {
  let depth = 0;
  for (let i = open; i < latex.length; i++) {
    const c = latex[i];
    if (c === '\\') i++;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return latex.length;
}

export function latexToPlainText(latex: string): string {
  let out = '';
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i] ?? '';

    if (c === '\\') {
      const next = latex[i + 1] ?? '';
      const name = /^[A-Za-z]+/.exec(latex.slice(i + 1))?.[0];
      if (!name) {
        if (ESCAPED.has(next)) out += next;
        else if (SPACING.has(next)) out += ' ';
        i++;
        continue;
      }
      // A command prints nothing itself; its `{argument}` is read on as a
      // plain group, so `\textbf{x}` leaves `x`. `\href`'s first argument is
      // the URL, which is skipped so only the link text remains.
      i += name.length;
      if (name === 'href' && latex[i + 1] === '{') i = closingBrace(latex, i + 1);
      continue;
    }

    // Grouping braces and math shifts (`$|$`) print nothing; `~` is a space.
    if (c === '{' || c === '}' || c === '$') continue;
    out += c === '~' ? ' ' : c;
  }
  return out.replace(/\s+/g, ' ').trim();
}
