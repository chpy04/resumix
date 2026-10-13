/**
 * `submit_for_review` against a real database, with the sidecar stubbed at
 * `fetch` (`stubLatex`), since the page count is what decides the answer
 * (C3, D-044).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../../types.ts';

const skip = !process.env.DATABASE_URL;

let submitForReview: typeof import('./submit-for-review.ts').submitForReview;
let getApplicationRow: typeof import('../../queries/applications.ts').getApplicationRow;
let createCoverLetter: typeof import('../../queries/cover-letters.ts').createCoverLetter;
let updateCoverLetter: typeof import('../../queries/cover-letters.ts').updateCoverLetter;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ submitForReview } = await import('./submit-for-review.ts'));
  ({ getApplicationRow } = await import('../../queries/applications.ts'));
  ({ createCoverLetter, updateCoverLetter } = await import('../../queries/cover-letters.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const LETTER_MARKER = '% submit-test letter';

function isLetter(tex: string): boolean {
  return tex.includes(LETTER_MARKER);
}

/** One application in `status` with a resume of its own and, unless told
 *  otherwise, a letter. */
async function setup(status: ApplicationStatus = 'proposing', withLetter = true) {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`submit-${tag}`);
  const resume = await fixtures.insertTestResume(user.id, tag);
  const letter = withLetter ? await createCoverLetter(user.id, `Letter ${tag}`) : null;
  if (letter) {
    await updateCoverLetter(user.id, letter.id, { content: `${LETTER_MARKER}\n\\end{document}` });
  }
  const app = await fixtures.insertTestApplication(user.id, tag, {
    status,
    resumeId: resume.id,
    coverLetterId: letter?.id ?? null,
  });
  return {
    user,
    app,
    status: async () => (await getApplicationRow(user.id, app.id))?.status,
    async cleanup() {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(resume.id);
      if (letter) await fixtures.deleteCoverLetterRow(letter.id);
    },
  };
}

function call(userId: string, applicationId: string) {
  return submitForReview.call({ userId }, { application_id: applicationId });
}

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? '';
}

test('one page each moves proposing to needs_review', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 1);
  try {
    const result = await call(s.user.id, s.app.id);
    assert.equal(result.isError, undefined, text(result));
    assert.deepEqual(JSON.parse(text(result)), {
      application_id: s.app.id,
      status: 'needs_review',
      resume_pages: 1,
      cover_letter_pages: 1,
    });
    assert.equal(latex.sent.length, 2, 'both documents were compiled');
    assert.equal(await s.status(), 'needs_review');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test(
  'with no letter only the resume is compiled, and cover_letter_pages is null',
  { skip },
  async () => {
    const s = await setup('proposing', false);
    const latex = fixtures.stubLatex(() => 1);
    try {
      const result = await call(s.user.id, s.app.id);
      assert.equal(
        (JSON.parse(text(result)) as { cover_letter_pages: unknown }).cover_letter_pages,
        null,
      );
      assert.equal(latex.sent.length, 1);
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test('resubmitting one already in review re-checks and keeps it there', { skip }, async () => {
  const s = await setup('needs_review');
  const latex = fixtures.stubLatex(() => 1);
  try {
    const result = await call(s.user.id, s.app.id);
    assert.equal(result.isError, undefined, text(result));
    assert.equal(latex.sent.length, 2);
    assert.equal(await s.status(), 'needs_review');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test(
  'a resume over one page is refused, and points at set_resume_selection',
  { skip },
  async () => {
    const s = await setup();
    const latex = fixtures.stubLatex((tex) => (isLetter(tex) ? 1 : 2));
    try {
      const result = await call(s.user.id, s.app.id);
      assert.equal(result.isError, true);
      assert.equal(
        text(result),
        'The resume is 2 pages; it must be one. Nothing was submitted. Call set_resume_selection ' +
          'with fewer bullets (its overflow lists what to drop first), then call submit_for_review again.',
      );
      assert.equal(await s.status(), 'proposing');
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test('a letter over one page is refused', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex((tex) => (isLetter(tex) ? 3 : 1));
  try {
    const result = await call(s.user.id, s.app.id);
    assert.equal(result.isError, true);
    assert.equal(
      text(result),
      'The cover letter is 3 pages; it must be one. Nothing was submitted. Shorten it, then ' +
        "call submit_for_review again; if you can't edit it, stop and tell Chris.",
    );
    assert.equal(await s.status(), 'proposing');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('a document that does not compile is refused with its errors', { skip }, async () => {
  const s = await setup();
  try {
    for (const [failing, name] of [
      [(tex: string) => !isLetter(tex), 'resume'],
      [isLetter, 'cover letter'],
    ] as const) {
      const latex = fixtures.stubLatex((tex) => (failing(tex) ? 'error' : 1));
      try {
        const result = await call(s.user.id, s.app.id);
        assert.equal(result.isError, true, name);
        assert.equal(
          text(result),
          `The ${name} does not compile: ${fixtures.STUB_LATEX_ERROR}. Nothing was submitted. ` +
            'Stop and tell Chris.',
        );
      } finally {
        latex.restore();
      }
    }
    assert.equal(await s.status(), 'proposing');
  } finally {
    await s.cleanup();
  }
});

test('an unreachable sidecar says to call again', { skip }, async () => {
  const s = await setup();
  try {
    for (const [failing, name] of [
      [(tex: string) => !isLetter(tex), 'resume'],
      [isLetter, 'cover letter'],
    ] as const) {
      const latex = fixtures.stubLatex((tex) => (failing(tex) ? 'down' : 1));
      try {
        const result = await call(s.user.id, s.app.id);
        assert.equal(result.isError, true, name);
        assert.match(
          text(result),
          new RegExp(
            `^Resumix could not compile the ${name} to count its pages \\(Could not reach the ` +
              'latex service.*\\)\\. Nothing was submitted\\. Call again in a minute; if it ' +
              'fails again, stop and tell Chris\\.$',
          ),
        );
      } finally {
        latex.restore();
      }
    }
    assert.equal(await s.status(), 'proposing');
  } finally {
    await s.cleanup();
  }
});

test('a ready application has nothing to submit', { skip }, async () => {
  const s = await setup('ready');
  const latex = fixtures.stubLatex(() => 1);
  try {
    const result = await call(s.user.id, s.app.id);
    assert.equal(result.isError, true);
    assert.equal(
      text(result),
      'This application is ready: Chris has approved it, so there is nothing to submit. ' +
        'Nothing was changed.',
    );
    assert.equal(latex.sent.length, 0);
    assert.equal(await s.status(), 'ready');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('a draft or a sent application is not the agent’s to submit', { skip }, async () => {
  const latex = fixtures.stubLatex(() => 1);
  try {
    for (const status of ['draft', 'applied', 'rejected'] as const) {
      const s = await setup(status);
      try {
        const result = await call(s.user.id, s.app.id);
        assert.equal(result.isError, true, status);
        assert.equal(
          text(result),
          `This application is ${status}, not one you are proposing, so it can't be submitted ` +
            'for review. Nothing was changed.',
        );
        assert.equal(await s.status(), status);
      } finally {
        await s.cleanup();
      }
    }
    assert.equal(latex.sent.length, 0);
  } finally {
    latex.restore();
  }
});

test('no resume linked is refused', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`submit-nr-${tag}`);
  const app = await fixtures.insertTestApplication(user.id, tag, { status: 'proposing' });
  try {
    const result = await call(user.id, app.id);
    assert.equal(result.isError, true);
    assert.equal(
      text(result),
      'This application has no resume. Nothing was submitted; ask Chris to link one.',
    );
  } finally {
    await fixtures.deleteApplicationRow(app.id);
  }
});

test('an unknown, archived or foreign application is not found', { skip }, async () => {
  const s = await setup();
  const archived = await fixtures.insertTestApplication(s.user.id, 'archived', {
    status: 'proposing',
    isArchived: true,
  });
  const bob = await fixtures.insertUser(`submit-bob-${fixtures.testTag()}`);
  const bobs = await fixtures.insertTestApplication(bob.id, 'bob', { status: 'proposing' });
  const latex = fixtures.stubLatex(() => 1);
  try {
    for (const id of [randomUUID(), archived.id, bobs.id]) {
      const result = await call(s.user.id, id);
      assert.equal(result.isError, true);
      assert.equal(
        text(result),
        `No application ${id}. Call list_applications to find its application_id.`,
      );
    }
    assert.equal(latex.sent.length, 0);
    assert.equal((await getApplicationRow(bob.id, bobs.id))?.status, 'proposing');
  } finally {
    latex.restore();
    await fixtures.deleteApplicationRow(archived.id);
    await fixtures.deleteApplicationRow(bobs.id);
    await s.cleanup();
  }
});
