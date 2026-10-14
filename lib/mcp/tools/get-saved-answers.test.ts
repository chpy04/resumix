/**
 * `get_saved_answers` against a real database (D-048): live answers only,
 * the caller's only, decoded as the agent sends them back, and `[]` when
 * there are none.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let getSavedAnswers: typeof import('./get-saved-answers.ts').getSavedAnswers;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ getSavedAnswers } = await import('./get-saved-answers.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

interface SavedJson {
  saved_answer_id: string;
  prompt: string;
  kind: string;
  answer_mode: string;
  answer: string | string[];
}

async function savedOf(userId: string): Promise<SavedJson[]> {
  const result = await getSavedAnswers.call({ userId }, {});
  assert.equal(result.isError, undefined, result.content[0]?.text);
  return JSON.parse(result.content[0]?.text ?? '') as SavedJson[];
}

test('get_saved_answers is [] for an account with none', { skip }, async () => {
  const user = await fixtures.insertUser(`gsa-none-${fixtures.testTag()}`);
  assert.deepEqual(await savedOf(user.id), []);
});

test(
  'get_saved_answers returns live answers only, oldest first, a multi one as a list',
  { skip },
  async () => {
    const user = await fixtures.insertUser(`gsa-${fixtures.testTag()}`);
    const veteran = await fixtures.insertSavedAnswer(user.id, {
      prompt: 'Veteran status',
      kind: 'choice',
      answer: 'I am not a protected veteran',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    await fixtures.insertSavedAnswer(user.id, {
      prompt: 'Retired',
      isArchived: true,
      createdAt: new Date('2026-10-02T00:00:00Z'),
    });
    const offices = await fixtures.insertSavedAnswer(user.id, {
      prompt: 'Which offices?',
      kind: 'multi',
      answer: '["NYC","Remote"]',
      createdAt: new Date('2026-10-03T00:00:00Z'),
    });
    const office = await fixtures.insertSavedAnswer(user.id, {
      prompt: 'Which office?',
      kind: 'choice',
      answerMode: 'instruction',
      answer: 'Boston if listed, otherwise Remote',
      createdAt: new Date('2026-10-04T00:00:00Z'),
    });

    assert.deepEqual(await savedOf(user.id), [
      {
        saved_answer_id: veteran.id,
        prompt: 'Veteran status',
        kind: 'choice',
        answer_mode: 'value',
        answer: 'I am not a protected veteran',
      },
      {
        saved_answer_id: offices.id,
        prompt: 'Which offices?',
        kind: 'multi',
        answer_mode: 'value',
        answer: ['NYC', 'Remote'],
      },
      {
        saved_answer_id: office.id,
        prompt: 'Which office?',
        kind: 'choice',
        answer_mode: 'instruction',
        answer: 'Boston if listed, otherwise Remote',
      },
    ]);
  },
);

test("get_saved_answers contains none of another user's", { skip }, async () => {
  const tag = fixtures.testTag();
  const alice = await fixtures.insertUser(`gsa-a-${tag}`);
  const bob = await fixtures.insertUser(`gsa-b-${tag}`);
  const bobs = await fixtures.insertSavedAnswer(bob.id, { answer: "Bob's answer" });
  const alices = await fixtures.insertSavedAnswer(alice.id);

  const text = JSON.stringify(await savedOf(alice.id));
  assert.ok(text.includes(alices.id));
  assert.ok(!text.includes(bobs.id));
  assert.ok(!text.includes("Bob's answer"));
});
