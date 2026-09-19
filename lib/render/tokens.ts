/**
 * Token scanning/substitution for `<<TOKEN_NAME>>` per docs/TEMPLATE_TOKENS.md.
 *
 * Chosen over `\Macro` (an unsubstituted one is a hard TeX error) and over
 * `%%X%%` (silently vanishes into a comment) — see docs/DECISIONS.md D-005.
 */

/** Matches the exact token grammar from the contract. */
export const TOKEN_PATTERN = /<<([A-Z_]+)>>/g;

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
