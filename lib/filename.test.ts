import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResumeFilename, slugifyForFilename } from './filename.ts';

test('lowercase words are title-cased', () => {
  assert.equal(slugifyForFilename('google cloud'), 'Google_Cloud');
});

test('all-caps words are normalized regardless of original casing', () => {
  assert.equal(slugifyForFilename('ACME corp'), 'Acme_Corp');
});

test('extra whitespace collapses', () => {
  assert.equal(slugifyForFilename('  Extra   Whitespace  '), 'Extra_Whitespace');
});

test('punctuation is treated as a word separator', () => {
  assert.equal(slugifyForFilename('Acme, Inc.'), 'Acme_Inc');
});

test('ampersands are dropped, not spelled out', () => {
  assert.equal(slugifyForFilename('Johnson & Johnson'), 'Johnson_Johnson');
});

test('apostrophes are removed without splitting the word', () => {
  // Casing is normalized regardless of input, same as the ACME case above,
  // so the embedded capital B does not survive — only the leading O does.
  assert.equal(slugifyForFilename("O'Brien's Bakery"), 'Obriens_Bakery');
});

test('leading digits are preserved as their own word when separated', () => {
  assert.equal(slugifyForFilename('7-Eleven'), '7_Eleven');
});

test('a word that is entirely digits round-trips', () => {
  assert.equal(slugifyForFilename('123 Solutions'), '123_Solutions');
});

test('non-ASCII letters are kept and capitalized sensibly', () => {
  assert.equal(slugifyForFilename('café con leche'), 'Café_Con_Leche');
});

test('underscores in the input act as separators too', () => {
  assert.equal(slugifyForFilename('under_score llc'), 'Under_Score_Llc');
});

test('empty or whitespace-only input falls back to a placeholder', () => {
  assert.equal(slugifyForFilename(''), 'Untitled');
  assert.equal(slugifyForFilename('   '), 'Untitled');
  assert.equal(slugifyForFilename('***'), 'Untitled');
});

test('buildResumeFilename uses the default prefix from the env var', () => {
  const previous = process.env.PDF_NAME_PREFIX;
  process.env.PDF_NAME_PREFIX = 'Chris_Pyle';
  try {
    assert.equal(
      buildResumeFilename('google cloud'),
      'Chris_Pyle_Google_Cloud_Resume.pdf',
    );
  } finally {
    if (previous === undefined) delete process.env.PDF_NAME_PREFIX;
    else process.env.PDF_NAME_PREFIX = previous;
  }
});

test('buildResumeFilename falls back to Chris_Pyle when the env var is unset', () => {
  const previous = process.env.PDF_NAME_PREFIX;
  delete process.env.PDF_NAME_PREFIX;
  try {
    assert.equal(buildResumeFilename('ACME corp'), 'Chris_Pyle_Acme_Corp_Resume.pdf');
  } finally {
    if (previous === undefined) delete process.env.PDF_NAME_PREFIX;
    else process.env.PDF_NAME_PREFIX = previous;
  }
});

test('buildResumeFilename accepts an explicit prefix override', () => {
  assert.equal(
    buildResumeFilename('Google Cloud', 'Jane_Doe'),
    'Jane_Doe_Google_Cloud_Resume.pdf',
  );
});
