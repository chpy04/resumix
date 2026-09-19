/**
 * Token scanning/substitution for `<<TOKEN_NAME>>` per docs/TEMPLATE_TOKENS.md.
 *
 * Chosen over `\Macro` (an unsubstituted one is a hard TeX error) and over
 * `%%X%%` (silently vanishes into a comment) — see docs/DECISIONS.md D-005.
 */

/** Matches the exact token grammar from the contract. */
export const TOKEN_PATTERN = /<<([A-Z_]+)>>/g;

/**
 * `<<IF:TOKEN>> ... <<ENDIF>>` — the block is kept only when TOKEN expands to
 * something non-empty, and dropped entirely otherwise.
 *
 * This exists because an empty section is a *fatal* LaTeX error, not a cosmetic
 * one: the template wraps each section in `\begin{itemize}...\end{itemize}`,
 * and an itemize containing no `\item` aborts the compile with
 * "Something's wrong--perhaps a missing \item". Deselecting every experience
 * (or project, or interests row) is a perfectly normal thing to do while
 * tailoring a resume, so the renderer has to handle it rather than leaving it
 * as a trap in the template.
 *
 * Dropping the whole block — not just the token — also means the `\section{}`
 * heading disappears with its content, instead of leaving a bare "Projects"
 * heading over empty space.
 *
 * Deliberately not nestable: one level covers every real case, and a nesting
 * grammar would be markedly harder to reason about when hand-editing LaTeX.
 */
const CONDITIONAL_PATTERN = /<<IF:([A-Z_]+)>>([\s\S]*?)<<ENDIF>>/g;

/**
 * Resolve `<<IF:TOKEN>>...<<ENDIF>>` blocks against the expansions, before
 * plain token substitution runs.
 */
export function resolveConditionals(
  template: string,
  values: Record<string, string>,
  warnings: string[],
): string {
  const warnedUnknown = new Set<string>();

  const out = template.replace(CONDITIONAL_PATTERN, (_match, name: string, body: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      if (!warnedUnknown.has(name)) {
        warnedUnknown.add(name);
        warnings.push(`unknown token <<${name}>> in <<IF:${name}>> — block dropped`);
      }
      return '';
    }
    return (values[name] as string).trim().length > 0 ? body : '';
  });

  // A stray opener or closer means the author mismatched them; the block will
  // not behave as intended, so say so rather than silently mis-rendering.
  for (const orphan of ['<<ENDIF>>', /<<IF:[A-Z_]+>>/]) {
    const found = typeof orphan === 'string' ? out.includes(orphan) : orphan.test(out);
    if (found) {
      warnings.push('unmatched <<IF:...>> / <<ENDIF>> in the template — check the pairing');
      break;
    }
  }

  return out;
}

/**
 * Replace every occurrence of every known token with its expansion.
 * Tokens absent from `values` are left verbatim in the output and each
 * distinct unknown token name produces one warning.
 */
export function substituteTokens(
  template: string,
  values: Record<string, string>,
  warnings: string[],
): string {
  const warnedUnknown = new Set<string>();
  return template.replace(TOKEN_PATTERN, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name] as string;
    }
    if (!warnedUnknown.has(name)) {
      warnedUnknown.add(name);
      warnings.push(`unknown token <<${name}>> left unsubstituted`);
    }
    return match;
  });
}
