/**
 * What to drop when a resume runs past one page (D-042). Pure, given the
 * library, the selection and the page count the compile reported.
 *
 * The sidecar reports pages and nothing finer, so how far over the page is
 * cannot be known without injecting TeX into the compile. Instead each
 * candidate bullet carries an estimate of the lines it takes, and the
 * ranking leans on the agent's own order: a bullet it put last under an
 * item is the one it values least there.
 */
import { latexToPlainText } from '../render/plain-text.ts';
import type { Bullet, Library, Selections } from '../types.ts';

/**
 * Characters of bullet text one line holds in the default template (10pt,
 * 7in text width). Measured on the reference resume: one-line bullets run to
 * 113 characters, and wrapped ones break after 105 to 114. Another template
 * makes the estimate rougher, not wrong in kind.
 */
export const BULLET_CHARS_PER_LINE = 115;

const MAX_CANDIDATES = 5;

export interface DropCandidate {
  id: string;
  kind: 'experience_bullet' | 'project_bullet';
  parent_id: string;
  /** The experience's company or the project's name, as plain text. */
  parent: string;
  est_lines: number;
  text: string;
}

export interface Overflow {
  candidates: DropCandidate[];
  advice: string;
}

export function estimateLines(plain: string): number {
  return Math.max(1, Math.ceil(plain.length / BULLET_CHARS_PER_LINE));
}

interface Ranked {
  candidate: DropCandidate;
  /** 0 for the last bullet under its item. */
  fromEnd: number;
  /** Position in print order; higher is lower on the page. */
  printOrder: number;
}

interface Item {
  id: string;
  name: string;
  bullets: Bullet[];
}

/** Experiences print above projects in the default template. */
function rank(library: Library, s: Selections): Ranked[] {
  const groups: {
    kind: DropCandidate['kind'];
    items: Item[];
    selected: string[];
    byParent: Record<string, string[]>;
  }[] = [
    {
      kind: 'experience_bullet',
      items: library.experiences.map((e) => ({ id: e.id, name: e.company, bullets: e.bullets })),
      selected: s.experiences,
      byParent: s.experienceBullets,
    },
    {
      kind: 'project_bullet',
      items: library.projects.map((p) => ({ id: p.id, name: p.name, bullets: p.bullets })),
      selected: s.projects,
      byParent: s.projectBullets,
    },
  ];

  const ranked: Ranked[] = [];
  let printOrder = 0;
  for (const group of groups) {
    for (const itemId of group.selected) {
      const item = group.items.find((i) => i.id === itemId);
      if (!item) continue;
      const bulletIds = group.byParent[itemId] ?? [];
      bulletIds.forEach((bulletId, index) => {
        const order = printOrder++;
        // Dropping an item's only bullet leaves a heading with nothing under
        // it; that is a call to drop the whole item, which advice covers.
        if (bulletIds.length < 2) return;
        const bullet = item.bullets.find((b) => b.id === bulletId);
        if (!bullet) return;
        const text = latexToPlainText(bullet.content);
        ranked.push({
          candidate: {
            id: bulletId,
            kind: group.kind,
            parent_id: itemId,
            parent: latexToPlainText(item.name),
            est_lines: estimateLines(text),
            text,
          },
          fromEnd: bulletIds.length - 1 - index,
          printOrder: order,
        });
      });
    }
  }
  return ranked;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Null when the resume fits. Otherwise up to five bullets to drop, best
 *  first, and one sentence saying what to do. */
export function suggestDrops(library: Library, s: Selections, pages: number): Overflow | null {
  if (pages <= 1) return null;

  const ranked = rank(library, s).sort(
    (a, b) =>
      a.fromEnd - b.fromEnd ||
      b.candidate.est_lines - a.candidate.est_lines ||
      b.printOrder - a.printOrder ||
      (a.candidate.id < b.candidate.id ? -1 : 1),
  );
  const top = ranked.slice(0, MAX_CANDIDATES);
  const lead = `${plural(pages, 'page')}: it must fit on one.`;

  const first = top[0];
  if (!first) {
    return {
      candidates: [],
      advice:
        `${lead} Every selected experience and project is down to one bullet, so remove a ` +
        'whole experience, project or skill row and call set_resume_selection again.',
    };
  }

  // Every item offering candidates offers its last bullet, so the first
  // candidate is always one.
  return {
    candidates: top.map((r) => r.candidate),
    advice:
      `${lead} Remove a bullet or a whole project and call set_resume_selection again. ` +
      `Try ${first.candidate.id} first, the last bullet under ${first.candidate.parent}, ` +
      `about ${plural(first.candidate.est_lines, 'line')}.`,
  };
}
