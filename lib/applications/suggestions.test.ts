import assert from 'node:assert/strict';
import { test } from 'node:test';

import { APPLICATION_STATUSES } from './status.ts';
import {
  normalizeSuggestionText,
  suggestionsLocked,
  suggestionTally,
  suggestionTextProblem,
} from './suggestions.ts';

test('text is collapsed to one line, as the escaper collapses it', () => {
  assert.equal(normalizeSuggestionText('  Cut p99\n\tlatency  '), 'Cut p99 latency');
  assert.equal(normalizeSuggestionText('40 engineers'), '40 engineers');
});

test('text must be there, short enough, and not LaTeX', () => {
  assert.equal(suggestionTextProblem(''), 'is required');
  assert.equal(suggestionTextProblem('x'.repeat(500)), null);
  assert.equal(suggestionTextProblem('x'.repeat(501)), 'must be at most 500 characters');
  assert.equal(
    suggestionTextProblem('Cut \\textbf{40\\%}'),
    'plain text: write it as it should read, without LaTeX',
  );
  assert.equal(suggestionTextProblem('Cut 40% & saved $2M'), null);
});

test('suggestions are resolved only in Needs review', () => {
  for (const status of APPLICATION_STATUSES) {
    const locked = suggestionsLocked(status);
    const expected = /^Suggestions are resolved in Needs review; this application is /;
    if (status === 'needs_review') assert.equal(locked, null);
    else assert.match(locked ?? '', expected);
  }
  assert.equal(
    suggestionsLocked('ready'),
    'Suggestions are resolved in Needs review; this application is Ready.',
  );
});

test('the tally says what is pending, or else what became of each', () => {
  const of = (...statuses: ('pending' | 'applied' | 'copied' | 'rejected')[]) =>
    suggestionTally(statuses.map((status) => ({ status })));
  assert.deepEqual(of('pending', 'pending', 'applied'), {
    pending: 2,
    text: '2 pending — resolve them in step 1',
  });
  assert.deepEqual(of('pending'), { pending: 1, text: '1 pending — resolve it in step 1' });
  assert.deepEqual(of('applied', 'rejected'), { pending: 0, text: '1 applied, 1 rejected' });
  assert.deepEqual(of('copied', 'copied', 'applied'), {
    pending: 0,
    text: '1 applied, 2 saved as new',
  });
});
