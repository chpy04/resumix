/**
 * `suggest_bullet`: the agent proposes a change to one bullet, which Chris
 * applies or rejects in review. It never writes to the library (D11, R2,
 * D-045): an edit names a bullet the resume shows and the text it would
 * read, an addition names an experience or project the resume shows and a
 * slot among its bullets.
 *
 * Every refusal happens before anything is written. `bullet_kind` is worked
 * out here from the id, so the agent never says which table it means (C1).
 * Once recorded, the resume is compiled with every pending suggestion laid
 * over it, so the page count is the one Chris's preview will show.
 */
import { z } from 'zod';
import { compileTex, LatexServiceError } from '../../latex.ts';
import {
  createBulletSuggestion,
  listBulletSuggestions,
  type NewBulletSuggestion,
} from '../../queries/bullet-suggestions.ts';
import { assembleLibrary } from '../../queries/library.ts';
import { renderResumeById } from '../../queries/render.ts';
import { getResumeRow } from '../../queries/resumes.ts';
import { getSelections } from '../../queries/selections.ts';
import { latexToPlainText } from '../../render/plain-text.ts';
import type { Bullet, BulletSuggestion, Library, Selections } from '../../types.ts';
import { bulletSuggestionRationale, bulletSuggestionText } from '../../validation.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

const input = z
  .strictObject({
    application_id: z.uuid(),
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
  })
  .superRefine((args, ctx) => {
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
  });

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

export const suggestBullet = defineTool({
  name: 'suggest_bullet',
  description:
    "Proposes a change to one bullet on an application's resume, for Chris to apply or reject " +
    'in review; it never changes the library. kind edit rewrites a bullet the resume shows ' +
    '(bullet_id). kind add proposes a new bullet under an experience or project the resume ' +
    'shows (parent_id), at position among its bullets there. Write proposed_text as plain ' +
    'text, never LaTeX. Only while the application is proposing, so before submit_for_review. ' +
    'A second edit of the same bullet replaces the first. Returns JSON { suggestion_id, kind, ' +
    'replaced, ok, pages }: pages counts the resume with every pending suggestion applied, and ' +
    'ok is true on one page.',
  input,
  async run(ctx, args) {
    const app = await findLiveApplication(ctx.userId, args.application_id);
    if (!app) return noSuchApplication(args.application_id);

    // Suggest, then submit (the board's flow): once Chris has it, a new
    // suggestion would change what he is in the middle of reviewing.
    if (app.status !== 'proposing') {
      return toolError(
        `This application is ${app.status}; suggestions can only be made while it is ` +
          "proposing. Nothing was written. Put anything else you'd change in your reply to Chris.",
      );
    }

    const resume = app.resumeId ? await getResumeRow(ctx.userId, app.resumeId) : null;
    if (!resume) {
      return toolError(
        'This application has no resume to suggest bullets for. Nothing was written; ask Chris ' +
          'to link one.',
      );
    }
    if (resume.isDefault) {
      return toolError(
        'This application is linked to the Default resume, which every new resume is copied ' +
          'from. Nothing was written; ask Chris to give it its own.',
      );
    }

    // Live content only, as get_library shows it: an archived or another
    // user's id reads the same as an unknown one.
    const [library, selections] = await Promise.all([
      assembleLibrary(ctx.userId, false),
      getSelections(resume.id),
    ]);
    const all = items(library);
    let suggestion: NewBulletSuggestion;

    if (args.kind === 'edit') {
      const bulletId = args.bullet_id ?? '';
      const item = all.find((i) => i.bullets.some((b) => b.id === bulletId));
      const bullet = item?.bullets.find((b) => b.id === bulletId);
      if (!item || !bullet) {
        return toolError(
          `No bullet ${bulletId} in the library. Nothing was written; call get_library for ` +
            'current ids.',
        );
      }
      if (!shownBullets(selections, item)?.includes(bulletId)) {
        return toolError(
          `Bullet ${bulletId} is not on this application's resume, so there is nothing to ` +
            'edit. Nothing was written. Select it with set_resume_selection first, or suggest ' +
            'an add.',
        );
      }
      if (sameText(args.proposed_text, latexToPlainText(bullet.content))) {
        return toolError("That is the bullet's current text. Nothing was written.");
      }
      suggestion = {
        kind: 'edit',
        bulletKind: item.kind,
        bulletId,
        proposedText: args.proposed_text,
        rationale: args.rationale,
      };
    } else {
      const parentId = args.parent_id ?? '';
      const position = args.position ?? 0;
      const item = all.find((i) => i.id === parentId);
      if (!item) {
        return toolError(
          `No experience or project ${parentId} in the library. Nothing was written; call ` +
            'get_library for current ids.',
        );
      }
      const shown = shownBullets(selections, item);
      if (shown === null) {
        return toolError(
          `That ${item.kind} (${parentId}) is not on this application's resume. Nothing was ` +
            'written. Select it with set_resume_selection first.',
        );
      }
      if (position > shown.length) {
        return toolError(
          `position ${position} is past the end: that ${item.kind} shows ${shown.length} ` +
            `bullet(s), so 0 puts it first and ${shown.length} last. Nothing was written.`,
        );
      }
      const existing = item.bullets.find((b) =>
        sameText(args.proposed_text, latexToPlainText(b.content)),
      );
      if (existing) {
        return toolError(
          `That is bullet ${existing.id}'s text already. Nothing was written; select ` +
            `${existing.id} with set_resume_selection instead.`,
        );
      }
      const pendingAdd = (await listBulletSuggestions(ctx.userId, app.id)).find(
        (s) =>
          s.kind === 'add' &&
          s.status === 'pending' &&
          s.parentId === parentId &&
          sameText(s.proposedText, args.proposed_text),
      );
      if (pendingAdd) {
        return toolError(`You already suggested that: ${pendingAdd.id}. Nothing was written.`);
      }
      suggestion = {
        kind: 'add',
        bulletKind: item.kind,
        parentId,
        position,
        proposedText: args.proposed_text,
        rationale: args.rationale,
      };
    }

    const { suggestion: saved, replaced } = await createBulletSuggestion(
      ctx.userId,
      app.id,
      suggestion,
    );

    const pending = await listBulletSuggestions(ctx.userId, app.id);
    const { tex } = await renderResumeById(ctx.userId, resume.id, undefined, pending);
    let compiled;
    try {
      compiled = await compileTex(tex);
    } catch (err) {
      if (!(err instanceof LatexServiceError)) throw err;
      return toolError(
        `The suggestion was saved as ${saved.id}, but Resumix could not compile the resume to ` +
          `count its pages (${err.message}). Nothing more is needed for this suggestion: ` +
          'submit_for_review counts the pages again. If that fails too, stop and tell Chris.',
      );
    }
    if (!compiled.ok || compiled.pages === null) {
      const errors = compiled.errors.slice(0, 3).join(' | ') || 'no page count came back';
      return toolError(
        `The suggestion was saved as ${saved.id}, but the resume no longer compiles with it: ` +
          `${errors}. Stop and tell Chris.`,
      );
    }

    return toolJson({
      suggestion_id: saved.id,
      kind: saved.kind,
      replaced,
      ok: compiled.pages === 1,
      pages: compiled.pages,
    });
  },
});
