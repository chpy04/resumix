/**
 * Subsequence fuzzy matcher, in the spirit of fzf/Sublime's "go to file".
 *
 * A query matches a target when every character of the query appears in the
 * target, in order (case-insensitive), not necessarily contiguously. Among
 * matches, results are scored so that:
 *   - contiguous runs score much higher than scattered single characters
 *   - matches starting at a word boundary (start of string, or right after
 *     a non-alphanumeric separator / camelCase transition) score higher
 *   - matches earlier in the string score slightly higher than later ones
 *   - shorter targets score slightly higher than longer ones, as a tiebreak
 *     favoring more precise matches over incidental substring hits
 */

export interface FuzzyMatch {
  /** Index into the original `items` array. */
  index: number;
  /** Higher is a better match. */
  score: number;
  /** Character indices into the target string that were matched, for highlighting. */
  positions: number[];
}

const CONTIGUOUS_BONUS = 15;
const WORD_BOUNDARY_BONUS = 30;
const FIRST_CHAR_BONUS = 10;
const GAP_PENALTY_PER_CHAR = 2;

function isWordChar(char: string): boolean {
  return /[a-z0-9]/i.test(char);
}

/**
 * Returns `null` if `query` is not a subsequence of `target`. Otherwise
 * returns the score and matched positions of the *best* subsequence
 * alignment found via a small dynamic-programming search — greedy
 * left-to-right matching is not enough because it can miss a much better
 * word-boundary alignment later in the string (e.g. query "rn" against
 * "resume-name" should prefer matching "name", not the "r" in "resume" plus
 * an incidental "n").
 */
export function fuzzyScore(query: string, target: string): { score: number; positions: number[] } | null {
  if (query.length === 0) return { score: 0, positions: [] };
  if (target.length === 0) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const n = q.length;
  const m = t.length;

  // dp[i][j] = best score matching q[0..i) using only t[0..j), or -Infinity
  // if impossible. back[i][j] = the target index used for q[i-1], for
  // reconstructing the match positions.
  const NEG = Number.NEGATIVE_INFINITY;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(NEG));
  const back: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-1));

  for (let j = 0; j <= m; j++) dp[0]![j] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = i; j <= m; j++) {
      const char = t[j - 1]!;
      let best = NEG;
      let bestBack = -1;

      if (char === q[i - 1]) {
        const prevBest = dp[i - 1]![j - 1]!;
        if (prevBest !== NEG) {
          let charScore = 1;

          const atStart = j - 1 === 0;
          // Boundary detection needs the *original* casing of the target —
          // `char`/`prevChar` here are already lowercased for comparison,
          // so camelCase transitions are read off `target` directly.
          const originalChar = target[j - 1]!;
          const originalPrevChar = j - 2 >= 0 ? target[j - 2]! : '';
          const prevChar = j - 2 >= 0 ? t[j - 2]! : '';
          const isCamelTransition =
            isWordChar(originalPrevChar) &&
            originalPrevChar === originalPrevChar.toLowerCase() &&
            originalChar !== originalChar.toLowerCase();
          const boundary = atStart || !isWordChar(prevChar) || isCamelTransition;

          if (boundary) charScore += WORD_BOUNDARY_BONUS;
          if (atStart) charScore += FIRST_CHAR_BONUS;

          const prevMatchIdx = back[i - 1]![j - 1]!;
          if (i > 1 && prevMatchIdx === j - 2) {
            charScore += CONTIGUOUS_BONUS;
          } else if (i > 1 && prevMatchIdx >= 0) {
            charScore -= (j - 2 - prevMatchIdx) * GAP_PENALTY_PER_CHAR;
          }

          best = prevBest + charScore;
          bestBack = j - 1;
        }
      }

      // Option: skip target char j-1 without consuming query char i (only
      // valid if we still have room, i.e. don't require it).
      const skip = dp[i]![j - 1]!;
      if (skip > best) {
        best = skip;
        bestBack = back[i]![j - 1]!;
      }

      dp[i]![j] = best;
      back[i]![j] = bestBack;
    }
  }

  const finalScore = dp[n]![m]!;
  if (finalScore === NEG) return null;

  // Reconstruct positions by walking back through the dp table.
  const positions: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (dp[i]![j] === dp[i]![j - 1]) {
      j -= 1;
      continue;
    }
    positions.push(j - 1);
    i -= 1;
    j -= 1;
  }
  positions.reverse();

  // Small bonus for shorter overall targets, so precise matches outrank
  // incidental substring hits inside much longer strings.
  const lengthBonus = Math.max(0, 20 - target.length) * 0.1;

  return { score: finalScore + lengthBonus, positions };
}

/**
 * Fuzzy-filters `items` against `query` using `getText` to extract the
 * searchable string from each item. Returns matches sorted best-first. An
 * empty query returns every item, in original order, with score 0.
 */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): FuzzyMatch[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return items.map((_, index) => ({ index, score: 0, positions: [] }));
  }

  const results: FuzzyMatch[] = [];
  for (let index = 0; index < items.length; index++) {
    const target = getText(items[index]!);
    const match = fuzzyScore(trimmed, target);
    if (match) results.push({ index, score: match.score, positions: match.positions });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
