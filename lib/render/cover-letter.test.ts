import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BODY_MARKER,
  bodyMarkerProblem,
  coverLetterTex,
  plainBodyToLatex,
  takesPlainBody,
} from './cover-letter.ts';
import { DEFAULT_COVER_LETTER } from './default-cover-letter.ts';

const SHELL = '\\begin{document}\n%%BODY%%\n\\end{document}\n';

test('a blank line starts a paragraph and a single line break is kept', () => {
  assert.equal(
    plainBodyToLatex(
      ' October 13, 2026\r\n\r\nDear Team,\r\n\r\n\r\nWe & you \n  ship 100%\n\n\nBest,\nChris \n\n',
    ),
    'October 13, 2026\n\nDear Team,\n\nWe \\& you\\newline\nship 100\\%\n\nBest,\\newline\nChris',
  );
});

test('a line starting with [ never follows \\\\', () => {
  const latex = plainBodyToLatex('Best,\n[Name]');
  assert.equal(latex, 'Best,\\newline\n[Name]');
  assert.ok(!latex.includes('\\\\'));
});

test('CR alone, whitespace-only lines and blank ends are handled like the rest', () => {
  assert.equal(plainBodyToLatex('\n \t\none\rtwo\n \n\t\nthree\n  '), 'one\\newline\ntwo\n\nthree');
});

test('an empty or blank body is no LaTeX at all', () => {
  assert.equal(plainBodyToLatex(''), '');
  assert.equal(plainBodyToLatex(' \n\r\n\t'), '');
});

test('a marker is a line holding only %%BODY%%', () => {
  for (const content of [
    '%%BODY%%',
    'a\n%%BODY%%\nb',
    'a\n  %%BODY%%\t\nb',
    'a\r\n%%BODY%%\r\nb',
    '\t%%BODY%%  \r\n',
  ]) {
    assert.equal(bodyMarkerProblem(content), null, JSON.stringify(content));
  }
  for (const content of [
    '',
    '% %%BODY%%',
    '%%BODY%% x',
    'x %%BODY%%',
    '%%body%%',
    '%%BODY%',
    '\\%%BODY%%',
  ]) {
    assert.match(
      bodyMarkerProblem(content) ?? '',
      /no line holding only %%BODY%%/,
      JSON.stringify(content),
    );
  }
});

test('two or more markers are a problem that says how many', () => {
  assert.equal(
    bodyMarkerProblem('%%BODY%%\n%%BODY%%'),
    'This letter has 2 %%BODY%% lines; keep exactly one, on its own line where the text belongs.',
  );
  assert.match(bodyMarkerProblem('%%BODY%%\n  %%BODY%%\n%%BODY%%\r\n') ?? '', /has 3 %%BODY%%/);
});

test('the default letter has exactly one marker', () => {
  assert.equal(bodyMarkerProblem(DEFAULT_COVER_LETTER), null);
  assert.ok(DEFAULT_COVER_LETTER.includes(`\n${BODY_MARKER}\n`));
});

test('with no body the content is the .tex byte for byte, whatever its markers', () => {
  for (const content of ['\\documentclass{article}', SHELL, `${SHELL}%%BODY%%\n`]) {
    assert.deepEqual(coverLetterTex(content, null), { ok: true, tex: content });
  }
});

test('a body replaces the marker line, indentation included', () => {
  assert.deepEqual(coverLetterTex('a\n   %%BODY%%\t\nb', 'Hi & bye\n\nChris'), {
    ok: true,
    tex: 'a\nHi \\& bye\n\nChris\nb',
  });
  // A CRLF letter keeps its line ending.
  assert.deepEqual(coverLetterTex('a\r\n%%BODY%%\r\nb', 'x'), { ok: true, tex: 'a\r\nx\r\nb' });
});

test('replacement patterns in the body are placed literally', () => {
  const result = coverLetterTex(SHELL, "$' $& $1 $$");
  assert.deepEqual(result, {
    ok: true,
    tex: "\\begin{document}\n\\$' \\$\\& \\$1 \\$\\$\n\\end{document}\n",
  });
});

test('a body with zero or two markers to go to is a failure', () => {
  const none = coverLetterTex('\\begin{document}\\end{document}', 'Hi');
  assert.equal(none.ok, false);
  assert.match(!none.ok ? none.error : '', /no line holding only %%BODY%%/);

  const two = coverLetterTex(`${SHELL}%%BODY%%\n`, 'Hi');
  assert.equal(two.ok, false);
  assert.match(!two.ok ? two.error : '', /has 2 %%BODY%% lines/);
});

test('an empty body still takes the marker line, printing nothing', () => {
  assert.deepEqual(coverLetterTex(SHELL, ''), {
    ok: true,
    tex: '\\begin{document}\n\n\\end{document}\n',
  });
});

test('a letter takes a plain body when it has one, or a marker for one', () => {
  assert.equal(takesPlainBody({ content: SHELL, body: null }), true);
  assert.equal(takesPlainBody({ content: SHELL, body: 'Hi' }), true);
  assert.equal(takesPlainBody({ content: '\\begin{document}', body: null }), false);
  assert.equal(takesPlainBody({ content: `${SHELL}%%BODY%%`, body: null }), false);
  // Stored rows never hold this (the query layer refuses it), but a draft
  // on screen can: the body is still there to edit.
  assert.equal(takesPlainBody({ content: '\\begin{document}', body: 'Hi' }), true);
});
