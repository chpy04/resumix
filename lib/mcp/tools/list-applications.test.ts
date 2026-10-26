/**
 * `list_applications` against a real database: both filters, archived
 * applications absent, and only the caller's own.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let listApplications: typeof import('./list-applications.ts').listApplications;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ listApplications } = await import('./list-applications.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

interface Listed {
  application_id: string;
  company: string;
  role_title: string;
  posting_url: string;
  status: string;
  fit_score: number | null;
  created_at: string;
}

async function list(userId: string, args: Record<string, unknown>): Promise<Listed[]> {
  const result = await listApplications.call({ userId }, args);
  assert.equal(result.isError, undefined, result.content[0]?.text);
  return JSON.parse(result.content[0]?.text ?? '') as Listed[];
}

test(
  'list_applications filters by posting_url and status, and hides archived ones',
  { skip },
  async () => {
    const tag = fixtures.testTag();
    const user = await fixtures.insertUser(`list-${tag}`);
    const bob = await fixtures.insertUser(`list-b-${tag}`);
    const url = `https://jobs.example.test/${tag}`;

    const proposing = await fixtures.insertTestApplication(user.id, `${tag}-p`, {
      postingUrl: url,
      status: 'proposing',
      fitScore: 4.3,
    });
    const draft = await fixtures.insertTestApplication(user.id, `${tag}-d`, {
      postingUrl: `${url}/other`,
    });
    const archived = await fixtures.insertTestApplication(user.id, `${tag}-a`, {
      postingUrl: url,
      status: 'proposing',
      isArchived: true,
    });
    const bobs = await fixtures.insertTestApplication(bob.id, `${tag}-b`, { postingUrl: url });
    try {
      const byUrl = await list(user.id, { posting_url: `  ${url} ` });
      assert.deepEqual(byUrl, [
        {
          application_id: proposing.id,
          company: proposing.company,
          role_title: proposing.roleTitle,
          posting_url: url,
          status: 'proposing',
          fit_score: 4.3,
          created_at: proposing.createdAt.toISOString(),
        },
      ]);

      assert.deepEqual(
        (await list(user.id, { status: 'draft' })).map((a) => a.application_id),
        [draft.id],
      );
      assert.deepEqual(await list(user.id, { posting_url: url, status: 'draft' }), []);

      // No filter: everything live, newest first, nothing archived.
      assert.deepEqual(
        (await list(user.id, {})).map((a) => a.application_id),
        [draft.id, proposing.id],
      );
    } finally {
      for (const a of [proposing, draft, archived, bobs]) await fixtures.deleteApplicationRow(a.id);
    }
  },
);

test('list_applications rejects an unknown status and an empty posting_url', { skip }, async () => {
  const user = await fixtures.insertUser(`list-bad-${fixtures.testTag()}`);
  for (const args of [{ status: 'sent' }, { posting_url: '  ' }, { postingUrl: 'x' }]) {
    const result = await listApplications.call({ userId: user.id }, args);
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(result.content[0]?.text ?? '', /^Invalid arguments/);
  }
});
