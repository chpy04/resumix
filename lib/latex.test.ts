import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latexUnavailableResult, LatexServiceError } from './latex.ts';

test('an unreachable sidecar degrades to a 200-shaped failure, not an empty preview', () => {
  const result = latexUnavailableResult(
    new LatexServiceError('could not reach the latex service'),
    ['unknown token <<NOPE>>'],
  );

  assert.equal(result.ok, false);
  assert.equal(result.pages, null);
  assert.deepEqual(result.errors, ['could not reach the latex service']);
  // Renderer warnings survive the service being down: they were produced
  // before the compile was ever attempted, and the editor still shows them.
  assert.deepEqual(result.warnings, ['unknown token <<NOPE>>']);
  assert.equal(result.log, '');
});

test('no pdfBase64 key at all, so a stale preview is never mistaken for a fresh one', () => {
  const result = latexUnavailableResult(new LatexServiceError('timed out'), []);

  // `ok: false` plus an absent `pdfBase64` is what PreviewPane keys on to
  // hold the last good PDF on screen (docs/API.md).
  assert.equal(result.pdfBase64, undefined);
  assert.ok(!Object.hasOwn(result, 'pdfBase64'));
});
