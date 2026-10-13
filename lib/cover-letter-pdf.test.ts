/**
 * What `compileCoverLetterPdf` sends the sidecar, read off `stubLatex`'s
 * record: the download, `submit_for_review` and final approval all compile
 * through it, so this is the `.tex` every one of them is built from (C4,
 * D-046). No rows are written; the database is needed only because the
 * stub lives in the query fixtures.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let compileCoverLetterPdf: typeof import('./cover-letter-pdf.ts').compileCoverLetterPdf;
let fixtures: typeof import('./queries/test-fixtures.ts');

if (!skip) {
  ({ compileCoverLetterPdf } = await import('./cover-letter-pdf.ts'));
  fixtures = await import('./queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const SHELL = '\\begin{document}\n  %%BODY%%\n\\end{document}\n';

test('a letter with no body is compiled exactly as written', { skip }, async () => {
  const latex = fixtures.stubLatex(() => 1);
  try {
    const compiled = await compileCoverLetterPdf({ name: 'Acme', content: SHELL, body: null });
    assert.ok(compiled.ok);
    assert.deepEqual(latex.sent, [SHELL]);
  } finally {
    latex.restore();
  }
});

test('a body is escaped into the marker line', { skip }, async () => {
  const latex = fixtures.stubLatex(() => 1);
  try {
    const compiled = await compileCoverLetterPdf({
      name: 'Acme',
      content: SHELL,
      body: 'Dear Team,\n\nR&D at 100%\nfor $5\n\nBest,\nChris',
    });
    assert.ok(compiled.ok);
    assert.deepEqual(latex.sent, [
      '\\begin{document}\nDear Team,\n\nR\\&D at 100\\%\\newline\nfor \\$5\n\n' +
        'Best,\\newline\nChris\n\\end{document}\n',
    ]);
  } finally {
    latex.restore();
  }
});

test('a body with no marker to go to fails without compiling', { skip }, async () => {
  const latex = fixtures.stubLatex(() => 1);
  try {
    const compiled = await compileCoverLetterPdf({
      name: 'Acme',
      content: '\\begin{document}\\end{document}',
      body: 'Hello',
    });
    assert.equal(compiled.ok, false);
    assert.match(!compiled.ok ? (compiled.errors[0] ?? '') : '', /no line holding only %%BODY%%/);
    assert.deepEqual(latex.sent, []);
  } finally {
    latex.restore();
  }
});
