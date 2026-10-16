/**
 * What `suggest_bullet` and `suggest_resume_bullet` share: the arguments that
 * describe one suggestion, and the checks that turn them into a
 * `NewBulletSuggestion` against the live library and the resume's selection.
 * One rule for both, so an application's resume and one of Chris's own
 * accept exactly the same suggestions (D-045, D-054).
 *
 * `bullet_kind` is worked out here from the id, so the agent never says
 * which table it means (C1).
 */
import { z } from 'zod';
import type { NewBulletSuggestion } from '../queries/bullet-suggestions.ts';
import { latexToPlainText } from '../render/plain-text.ts';
import type { Bullet, BulletSuggestion, Library, Selections } from '../types.ts';
import { bulletSuggestionRationale, bulletSuggestionText } from '../validation.ts';

/** The fields of one suggestion, beside whatever names the resume. */
export const suggestionFields = {
  kind: z.enum(['edit', 'add']).describe('edit rewrites a bullet; add proposes a new one.'),
  bullet_id: z
    .uuid()
    .optional()
    .describe('edit only: the bullet to rewrite, from get_library. It must be on the resume.'),
  parent_id: z
    .uuid()
    .optional()
    .describe(
      'add only: the experience or project it goes under, from get_library. It must be on ' +
        'the resume.',
    ),
  position: z
    .int()
    .min(0)
    .optional()
    .describe(
      "add only: where among that item's bullets on the resume, n of them: 0 puts it first, " +
        'n last.',
    ),
  proposed_text: bulletSuggestionText.describe(
    'The bullet as it should read: one line of plain text, at most 500 characters, never ' +
      'LaTeX. Resumix escapes it.',
  ),
  rationale: bulletSuggestionRationale.describe(
    'Why, in a sentence Chris reads beside it, at most 300 characters.',
  ),
};

export interface SuggestionArgs {
  kind: 'edit' | 'add';
  bullet_id?: string | undefined;
  parent_id?: string | undefined;
  position?: number | undefined;
  proposed_text: string;
  rationale: string;
}

/** Which ids go with which kind, for a schema's `superRefine`. */
export function refineSuggestion(args: SuggestionArgs, ctx: z.RefinementCtx): void {
  const wrong = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (args.kind === 'edit') {
    if (args.bullet_id === undefined) wrong('bullet_id', 'is required for an edit');
    if (args.parent_id !== undefined)
      wrong('parent_id', 'is for an add; an edit names only bullet_id');
    if (args.position !== undefined)
      wrong('position', 'is for an add; an edit names only bullet_id');
  } else {
    if (args.parent_id === undefined) wrong('parent_id', 'is required for an add');
    if (args.position === undefined) wrong('position', 'is required for an add');
    if (args.bullet_id !== undefined) {
      wrong('bullet_id', 'is for an edit; an add names parent_id and position');
    }
  }
}

type Kind = BulletSuggestion['bulletKind'];

interface Item {
  kind: Kind;
  id: string;
  bullets: Bullet[];
}

/** Every live experience and project, with what the agent calls them. */
function items(library: Library): Item[] {
  return [
    ...library.experiences.map((e) => ({
      kind: 'experience' as const,
      id: e.id,
      bullets: e.bullets,
    })),
    ...library.projects.map((p) => ({ kind: 'project' as const, id: p.id, bullets: p.bullets })),
  ];
}

/** The ids this resume shows under `item`, in print order, or null when it
 *  does not show the item at all. */
function shownBullets(selections: Selections, item: Item): string[] | null {
  const [selected, byParent] =
    item.kind === 'experience'
      ? [selections.experiences, selections.experienceBullets]
      : [selections.projects, selections.projectBullets];
  return selected.includes(item.id) ? (byParent[item.id] ?? []) : null;
}

/** Two texts that would print the same, for the duplicate checks. */
function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** How a refusal names the resume, and the tool that selects onto it. */
export interface SuggestionWording {
  /** "this application's resume", or "this resume". */
  resume: string;
  /** The tool that sets that resume's selection. */
  selectTool: string;
}

/**
 * The suggestion `args` describe, or the refusal to answer with, which says
 * what to do next and that nothing was written. `library` is live content
 * only, as get_library shows it, so an archived or another user's id reads
 * the same as an unknown one; `existing` is every suggestion already made on
 * this resume, for the duplicate-add check.
 */
export function checkSuggestion(
  args: SuggestionArgs,
  library: Library,
  selections: Selections,
  existing: readonly BulletSuggestion[],
  wording: SuggestionWording,
): NewBulletSuggestion | { refusal: string } {
  const all = items(library);
  const refuse = (refusal: string) => ({ refusal });

  if (args.kind === 'edit') {
    const bulletId = args.bullet_id ?? '';
    const item = all.find((i) => i.bullets.some((b) => b.id === bulletId));
    const bullet = item?.bullets.find((b) => b.id === bulletId);
    if (!item || !bullet) {
      return refuse(
        `No bullet ${bulletId} in the library. Nothing was written; call get_library for ` +
          'current ids.',
      );
    }
    if (!shownBullets(selections, item)?.includes(bulletId)) {
      return refuse(
        `Bullet ${bulletId} is not on ${wording.resume}, so there is nothing to edit. ` +
          `Nothing was written. Select it with ${wording.selectTool} first, or suggest an add.`,
      );
    }
    if (sameText(args.proposed_text, latexToPlainText(bullet.content))) {
      return refuse("That is the bullet's current text. Nothing was written.");
    }
    return {
      kind: 'edit',
      bulletKind: item.kind,
      bulletId,
      proposedText: args.proposed_text,
      rationale: args.rationale,
    };
  }

  const parentId = args.parent_id ?? '';
  const position = args.position ?? 0;
  const item = all.find((i) => i.id === parentId);
  if (!item) {
    return refuse(
      `No experience or project ${parentId} in the library. Nothing was written; call ` +
        'get_library for current ids.',
    );
  }
  const shown = shownBullets(selections, item);
  if (shown === null) {
    return refuse(
      `That ${item.kind} (${parentId}) is not on ${wording.resume}. Nothing was written. ` +
        `Select it with ${wording.selectTool} first.`,
    );
  }
  if (position > shown.length) {
    return refuse(
      `position ${position} is past the end: that ${item.kind} shows ${shown.length} ` +
        `bullet(s), so 0 puts it first and ${shown.length} last. Nothing was written.`,
    );
  }
  const duplicate = item.bullets.find((b) =>
    sameText(args.proposed_text, latexToPlainText(b.content)),
  );
  if (duplicate) {
    return refuse(
      `That is bullet ${duplicate.id}'s text already. Nothing was written; select ` +
        `${duplicate.id} with ${wording.selectTool} instead.`,
    );
  }
  const pendingAdd = existing.find(
    (s) =>
      s.kind === 'add' &&
      s.status === 'pending' &&
      s.parentId === parentId &&
      sameText(s.proposedText, args.proposed_text),
  );
  if (pendingAdd) {
    return refuse(`You already suggested that: ${pendingAdd.id}. Nothing was written.`);
  }
  return {
    kind: 'add',
    bulletKind: item.kind,
    parentId,
    position,
    proposedText: args.proposed_text,
    rationale: args.rationale,
  };
}
