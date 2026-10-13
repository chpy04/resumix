import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeLatex } from './escape.ts';

test('each of the thirteen specials has its own replacement', () => {
  const table: [string, string][] = [
    ['\\', '\\textbackslash{}'],
    ['{', '\\{'],
    ['}', '\\}'],
    ['$', '\\$'],
    ['&', '\\&'],
    ['#', '\\#'],
    ['^', '\\textasciicircum{}'],
    ['_', '\\_'],
    ['%', '\\%'],
    ['~', '\\textasciitilde{}'],
    ['<', '\\textless{}'],
    ['>', '\\textgreater{}'],
    ['|', '\\textbar{}'],
  ];
  assert.equal(table.length, 13);
  for (const [input, expected] of table) {
    assert.equal(escapeLatex(input), expected, input);
    assert.equal(escapeLatex(`a${input}b`), `a${expected}b`, input);
  }
});

test('one pass: the braces a replacement inserts are not escaped again', () => {
  assert.equal(escapeLatex('\\{}'), '\\textbackslash{}\\{\\}');
  assert.equal(escapeLatex('~^'), '\\textasciitilde{}\\textasciicircum{}');
});

test('text that looks like LaTeX is escaped like any other text', () => {
  assert.equal(escapeLatex('\\textbf{x}'), '\\textbackslash{}textbf\\{x\\}');
  assert.equal(escapeLatex('R\\&D'), 'R\\textbackslash{}\\&D');
  assert.equal(escapeLatex('$5 & 100% #1 snake_case'), '\\$5 \\& 100\\% \\#1 snake\\_case');
});

test('replacement patterns in the text are just text', () => {
  assert.equal(escapeLatex("$' $& $1"), "\\$' \\$\\& \\$1");
});

test('ASCII whitespace, newlines included, collapses to one space and the ends are trimmed', () => {
  assert.equal(escapeLatex('  one \t two\n\nthree\r\n four\f\v '), 'one two three four');
  assert.equal(escapeLatex(' \n\t '), '');
  assert.equal(escapeLatex(''), '');
});

test('a non-breaking space is kept, at the ends too', () => {
  assert.equal(escapeLatex('Dr. Who'), 'Dr. Who');
  assert.equal(escapeLatex('  x  '), ' x ');
});

test('Unicode, ASCII quotes and dashes pass through untouched', () => {
  for (const text of [
    '‘single’ “double”',
    'en – em —',
    'café résumé',
    'and so on…',
    'a "quoted" word',
    "it's",
    'pages 1--2 --- or so',
  ]) {
    assert.equal(escapeLatex(text), text);
  }
});
