import assert from 'node:assert/strict';
import { test } from 'node:test';

import { V1_EXPERIENCES, V1_PROJECTS, V1_SKILL_ROWS } from '../seed-data/v1-resume.ts';
import { latexToPlainText } from './plain-text.ts';

test('a command keeps its argument and loses its name', () => {
  assert.equal(latexToPlainText('for \\textbf{250+} users'), 'for 250+ users');
  assert.equal(latexToPlainText('\\textit{\\textbf{nested}}'), 'nested');
});

test('\\href keeps the link text and drops the URL', () => {
  assert.equal(
    latexToPlainText('on an \\href{https://example.com/a_b}{\\underline{ERP system}} serving'),
    'on an ERP system serving',
  );
});

test('escaped specials become the character they stand for', () => {
  assert.equal(
    latexToPlainText('\\$40,000 \\& 50\\% \\#1 snake\\_case'),
    '$40,000 & 50% #1 snake_case',
  );
});

test('math shifts lose their dollar signs, but an escaped dollar survives', () => {
  assert.equal(latexToPlainText('Skiing $|$ Hiking'), 'Skiing | Hiking');
  assert.equal(latexToPlainText('\\textbf{\\$600+} in $x$'), '$600+ in x');
});

test('a bare command is dropped, and spacing commands become a space', () => {
  assert.equal(latexToPlainText('\\LaTeX{} rocks'), 'rocks');
  assert.equal(latexToPlainText('one\\\\two\\,three\\ four'), 'one two three four');
  assert.equal(latexToPlainText('hy\\-phen'), 'hyphen');
});

test('~ is a space, and whitespace collapses', () => {
  assert.equal(latexToPlainText('  Dr.~Who   and\n\tfriends '), 'Dr. Who and friends');
});

test('an unclosed \\href argument does not throw', () => {
  assert.equal(latexToPlainText('see \\href{https://example.com'), 'see');
});

test('every seeded string comes out with no LaTeX syntax left in it', () => {
  const strings = [
    ...V1_EXPERIENCES.flatMap((e) => [
      e.company,
      e.title,
      e.dateRange,
      e.location,
      ...e.bullets.map((b) => b.content),
    ]),
    ...V1_PROJECTS.flatMap((p) => [
      p.name,
      p.technologies,
      p.dateRange,
      ...p.bullets.map((b) => b.content),
    ]),
    ...V1_SKILL_ROWS.flatMap((r) => [r.name, ...r.skills.map((s) => s.name)]),
  ];
  for (const latex of strings) {
    const plain = latexToPlainText(latex);
    assert.ok(plain.length > 0, latex);
    assert.doesNotMatch(plain, /[\\{}]/, latex);
    assert.doesNotMatch(plain, /\s{2}|^\s|\s$/, latex);
  }
});

test('a seeded bullet reads the way it prints', () => {
  const unicode = V1_EXPERIENCES.find((e) => e.company === 'Unicode');
  assert.equal(
    latexToPlainText(unicode?.bullets[0]?.content ?? ''),
    'Developed backend for the Adopt A Character site in Svelte, involving schema design, ' +
      'payment processing, and integration with internal and external databases. ' +
      'Generated $40,000 revenue in the first 2.5 months of deployment',
  );
});
