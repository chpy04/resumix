/**
 * The `ping` tool against a real database. Its one job is to say whose token
 * this is, so the test is that two accounts each get their own answer.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let ping: typeof import('./ping.ts').ping;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ ping } = await import('./ping.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

test('ping returns the email of the account that called it', { skip }, async () => {
  const a = await fixtures.insertUser(`ping-a-${fixtures.testTag()}`);
  const b = await fixtures.insertUser(`ping-b-${fixtures.testTag()}`);

  for (const user of [a, b]) {
    const result = await ping.call({ userId: user.id }, {});
    assert.deepEqual(result, { content: [{ type: 'text', text: user.email }] });
  }
});

test('ping for an account that no longer exists is isError', { skip }, async () => {
  const result = await ping.call({ userId: randomUUID() }, {});
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? '', /token:create/);
});
