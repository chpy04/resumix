import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BulletSuggestion, Library, Selections } from '../types.ts';
import { renderResume } from './index.ts';
import { insertAt, overlaySuggestions, suggestedBulletId, swapIn } from './suggestions.ts';

const TEMPLATE = '<<IF:EXPERIENCES>><<EXPERIENCES>><<ENDIF>>\n<<IF:PROJECTS>><<PROJECTS>><<ENDIF>>';

function library(): Library {
  return {
    experiences: [
      {
        id: 'exp',
        company: 'Acme',
        title: 'Engineer',
        dateRange: '2024',
        location: 'Remote',
        isArchived: false,
        bullets: [
          { id: 'b1', content: 'Cut latency \\textbf{40\\%}', isArchived: false },
          { id: 'b2', content: 'Shipped tooling', isArchived: false },
          { id: 'b3', content: 'Led a migration', isArchived: false },
        ],
      },
    ],
    projects: [
      {
        id: 'proj',
        name: 'Resumix',
        technologies: 'TypeScript',
        dateRange: '2025',
        isArchived: false,
        bullets: [{ id: 'p1', content: 'Built it', isArchived: false }],
      },
    ],
    skillRows: [],
    templates: [],
  };
}

function selections(): Selections {
  return {
    experiences: ['exp'],
    experienceBullets: { exp: ['b1', 'b2'] },
    projects: ['proj'],
    projectBullets: { proj: ['p1'] },
    skillRows: [],
    skills: {},
  };
}

let next = 0;
function suggestion(overrides: Partial<BulletSuggestion>): BulletSuggestion {
  next++;
  return {
    id: `s${next}`,
    kind: 'edit',
    bulletKind: 'experience',
    bulletId: null,
    parentId: null,
    position: null,
    proposedText: `text ${next}`,
    rationale: 'because',
    status: 'pending',
    createdAt: new Date(Date.UTC(2026, 9, 13, 0, 0, next)).toISOString(),
    ...overrides,
  };
}

const edit = (bulletId: string, proposedText: string, extra: Partial<BulletSuggestion> = {}) =>
  suggestion({ kind: 'edit', bulletId, proposedText, ...extra });
const add = (parentId: string, position: number, proposedText: string) =>
  suggestion({ kind: 'add', parentId, position, proposedText });

// ---------------------------------------------------------------------------
// The two list helpers
// ---------------------------------------------------------------------------

test('insertAt puts an id at its position, clamped to the ends', () => {
  assert.deepEqual(insertAt(['a', 'b'], 'x', 0), ['x', 'a', 'b']);
  assert.deepEqual(insertAt(['a', 'b'], 'x', 1), ['a', 'x', 'b']);
  assert.deepEqual(insertAt(['a', 'b'], 'x', 2), ['a', 'b', 'x']);
  assert.deepEqual(insertAt(['a', 'b'], 'x', 9), ['a', 'b', 'x']);
  assert.deepEqual(insertAt([], 'x', 3), ['x']);
});

test('swapIn replaces in place, or appends when the old id is not there', () => {
  assert.deepEqual(swapIn(['a', 'b', 'c'], 'b', 'x'), ['a', 'x', 'c']);
  assert.deepEqual(swapIn(['a', 'c'], 'b', 'x'), ['a', 'c', 'x']);
});

// ---------------------------------------------------------------------------
// The overlay
// ---------------------------------------------------------------------------

test("an edit replaces the bullet's content with its escaped text", () => {
  const warnings: string[] = [];
  const out = overlaySuggestions(
    library(),
    selections(),
    [edit('b1', 'Cut p99 latency 40% & saved $2M')],
    warnings,
  );
  assert.equal(
    out.library.experiences[0]?.bullets[0]?.content,
    'Cut p99 latency 40\\% \\& saved \\$2M',
  );
  assert.deepEqual(out.selections, selections());
  assert.deepEqual(warnings, []);
});

test('an add is a bullet of its own, selected at its position under its parent', () => {
  const s = add('exp', 1, 'Built on-call tooling');
  const out = overlaySuggestions(library(), selections(), [s], []);
  const id = suggestedBulletId(s.id);
  assert.deepEqual(out.selections.experienceBullets.exp, ['b1', id, 'b2']);
  const bullet = out.library.experiences[0]?.bullets.find((b) => b.id === id);
  assert.deepEqual(bullet, { id, content: 'Built on-call tooling', isArchived: false });
});

test('an add past the end goes last, and adds at one position keep creation order', () => {
  const late = add('exp', 7, 'last');
  const first = add('exp', 0, 'first A');
  const second = add('exp', 0, 'first B');
  const out = overlaySuggestions(library(), selections(), [late, first, second], []);
  assert.deepEqual(out.selections.experienceBullets.exp, [
    suggestedBulletId(first.id),
    suggestedBulletId(second.id),
    'b1',
    'b2',
    suggestedBulletId(late.id),
  ]);
});

test('project suggestions land under projects, not experiences', () => {
  const s = suggestion({ kind: 'add', bulletKind: 'project', parentId: 'proj', position: 0 });
  const e = edit('p1', 'Built it twice', { bulletKind: 'project' });
  const out = overlaySuggestions(library(), selections(), [s, e], []);
  assert.deepEqual(out.selections.projectBullets.proj, [suggestedBulletId(s.id), 'p1']);
  assert.equal(out.library.projects[0]?.bullets[0]?.content, 'Built it twice');
  assert.deepEqual(out.selections.experienceBullets, selections().experienceBullets);
});

test('only pending suggestions count', () => {
  const resolved = (['applied', 'copied', 'rejected'] as const).map((status) =>
    edit('b1', `resolved as ${status}`, { status }),
  );
  const lib = library();
  const sel = selections();
  const out = overlaySuggestions(lib, sel, resolved, []);
  assert.equal(out.library, lib);
  assert.equal(out.selections, sel);
});

test('a missing target is a warning, never a throw', () => {
  const warnings: string[] = [];
  const lost = edit('nope', 'x');
  const orphan = add('gone', 0, 'y');
  // An experience bullet's id under the wrong kind is missing too.
  const wrongKind = edit('b1', 'z', { bulletKind: 'project' });
  const out = overlaySuggestions(library(), selections(), [lost, orphan, wrongKind], warnings);
  assert.deepEqual(warnings, [
    `suggestions/${lost.id}: no experience bullet "nope" (suggestion skipped)`,
    `suggestions/${orphan.id}: no experience "gone" (suggestion skipped)`,
    `suggestions/${wrongKind.id}: no project bullet "b1" (suggestion skipped)`,
  ]);
  assert.deepEqual(out.selections, selections());
  assert.deepEqual(out.library, library());
});

test('the inputs are never changed', () => {
  const lib = library();
  const sel = selections();
  overlaySuggestions(lib, sel, [edit('b1', 'changed'), add('exp', 0, 'added')], []);
  assert.deepEqual(lib, library());
  assert.deepEqual(sel, selections());
});

// ---------------------------------------------------------------------------
// Through renderResume
// ---------------------------------------------------------------------------

test('with no suggestions, renderResume output is unchanged', () => {
  const plain = renderResume({
    templateContent: TEMPLATE,
    library: library(),
    selections: selections(),
  });
  const empty = renderResume({
    templateContent: TEMPLATE,
    library: library(),
    selections: selections(),
    suggestions: [],
  });
  assert.deepEqual(empty, plain);
  assert.ok(plain.tex.includes('\\resumeItem{Cut latency \\textbf{40\\%}}'));
});

test('renderResume renders an edit and an add in their places', () => {
  const { tex, warnings } = renderResume({
    templateContent: TEMPLATE,
    library: library(),
    selections: selections(),
    suggestions: [edit('b1', 'Cut p99 latency 40%'), add('exp', 2, 'Built on-call tooling')],
  });
  assert.deepEqual(warnings, []);
  const items = tex.split('\n').filter((line) => line.includes('\\resumeItem{'));
  assert.deepEqual(items, [
    '  \\resumeItem{Cut p99 latency 40\\%}',
    '  \\resumeItem{Shipped tooling}',
    '  \\resumeItem{Built on-call tooling}',
    '  \\resumeItem{Built it}',
  ]);
});
