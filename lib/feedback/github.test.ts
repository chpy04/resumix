import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIssue,
  FeedbackConfigError,
  GitHubApiError,
  readGitHubConfig,
  uploadScreenshot,
  type GitHubConfig,
} from './github.ts';

const CONFIG: GitHubConfig = {
  token: 't0ken',
  owner: 'chpy04',
  repo: 'resumix',
  assetsBranch: 'feedback-assets',
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

/** Installs a `fetch` that replies from `routes`, recording every call.
 *  Returns the recording plus a restore function. */
function stubFetch(routes: (call: Call) => { status: number; body: unknown }): {
  calls: Call[];
  restore: () => void;
} {
  const calls: Call[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      path: String(input).replace('https://api.github.com', ''),
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(call);
    const { status, body } = routes(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

test('config is read from GITHUB_TOKEN and GITHUB_REPO', () => {
  const config = readGitHubConfig({ GITHUB_TOKEN: 'abc', GITHUB_REPO: 'owner/repo' });
  assert.equal(config.owner, 'owner');
  assert.equal(config.repo, 'repo');
  assert.equal(config.assetsBranch, 'feedback-assets');
});

test('the assets branch is overridable', () => {
  const config = readGitHubConfig({
    GITHUB_TOKEN: 'abc',
    GITHUB_REPO: 'owner/repo',
    FEEDBACK_ASSETS_BRANCH: 'shots',
  });
  assert.equal(config.assetsBranch, 'shots');
});

test('a missing token fails closed rather than defaulting', () => {
  assert.throws(() => readGitHubConfig({ GITHUB_REPO: 'owner/repo' }), FeedbackConfigError);
  assert.throws(() => readGitHubConfig({ GITHUB_TOKEN: '   ', GITHUB_REPO: 'o/r' }), FeedbackConfigError);
});

test('a malformed repo slug is rejected', () => {
  assert.throws(() => readGitHubConfig({ GITHUB_TOKEN: 'abc', GITHUB_REPO: 'resumix' }), FeedbackConfigError);
  assert.throws(() => readGitHubConfig({ GITHUB_TOKEN: 'abc', GITHUB_REPO: 'a/b/c' }), FeedbackConfigError);
  assert.throws(() => readGitHubConfig({ GITHUB_TOKEN: 'abc', GITHUB_REPO: '/repo' }), FeedbackConfigError);
});

// ---------------------------------------------------------------------------
// Screenshot upload
// ---------------------------------------------------------------------------

test('uploading onto an existing branch commits on top of its head', async () => {
  const { calls, restore } = stubFetch((call) => {
    if (call.path.endsWith('/git/blobs')) return { status: 201, body: { sha: 'blob1' } };
    if (call.path.endsWith('/git/ref/heads/feedback-assets')) {
      return { status: 200, body: { object: { sha: 'head1' } } };
    }
    if (call.path.endsWith('/git/commits/head1')) return { status: 200, body: { tree: { sha: 'tree0' } } };
    if (call.path.endsWith('/git/trees')) return { status: 201, body: { sha: 'tree1' } };
    if (call.path.endsWith('/git/commits')) return { status: 201, body: { sha: 'commit1' } };
    return { status: 200, body: {} };
  });

  try {
    const url = await uploadScreenshot(CONFIG, new Uint8Array([1, 2, 3]), 'screenshots/a.png', 'msg');
    assert.equal(url, 'https://raw.githubusercontent.com/chpy04/resumix/commit1/screenshots/a.png');
  } finally {
    restore();
  }

  const tree = calls.find((c) => c.path.endsWith('/git/trees'))!;
  assert.equal(tree.body!.base_tree, 'tree0');
  const commit = calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/commits'))!;
  assert.deepEqual(commit.body!.parents, ['head1']);
  // Existing branch -> move the ref, don't try to create it again.
  const ref = calls.find((c) => c.path.endsWith('/git/refs/heads/feedback-assets'))!;
  assert.equal(ref.method, 'PATCH');
});

test('the first ever upload creates the assets branch as an orphan', async () => {
  const { calls, restore } = stubFetch((call) => {
    if (call.path.endsWith('/git/blobs')) return { status: 201, body: { sha: 'blob1' } };
    if (call.path.endsWith('/git/ref/heads/feedback-assets')) {
      return { status: 404, body: { message: 'Not Found' } };
    }
    if (call.path.endsWith('/git/trees')) return { status: 201, body: { sha: 'tree1' } };
    if (call.path.endsWith('/git/commits')) return { status: 201, body: { sha: 'commit1' } };
    return { status: 201, body: {} };
  });

  try {
    await uploadScreenshot(CONFIG, new Uint8Array([1]), 'screenshots/a.png', 'msg');
  } finally {
    restore();
  }

  const tree = calls.find((c) => c.path.endsWith('/git/trees'))!;
  assert.equal(tree.body!.base_tree, undefined, 'an orphan commit must not inherit the code tree');
  const commit = calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/commits'))!;
  assert.deepEqual(commit.body!.parents, []);
  const ref = calls.find((c) => c.path === '/repos/chpy04/resumix/git/refs')!;
  assert.equal(ref.method, 'POST');
  assert.equal(ref.body!.ref, 'refs/heads/feedback-assets');
});

test('bytes are sent base64-encoded', async () => {
  const { calls, restore } = stubFetch((call) => {
    if (call.path.endsWith('/git/blobs')) return { status: 201, body: { sha: 'blob1' } };
    if (call.path.endsWith('/git/ref/heads/feedback-assets')) return { status: 404, body: {} };
    if (call.path.endsWith('/git/trees')) return { status: 201, body: { sha: 'tree1' } };
    if (call.path.endsWith('/git/commits')) return { status: 201, body: { sha: 'commit1' } };
    return { status: 201, body: {} };
  });

  try {
    await uploadScreenshot(CONFIG, new TextEncoder().encode('hello'), 'a.png', 'msg');
  } finally {
    restore();
  }

  const blob = calls[0]!;
  assert.equal(blob.body!.encoding, 'base64');
  assert.equal(blob.body!.content, 'aGVsbG8=');
});

test('a failed upload surfaces GitHub\'s own message', async () => {
  const { restore } = stubFetch(() => ({ status: 403, body: { message: 'Resource not accessible' } }));
  try {
    await assert.rejects(
      uploadScreenshot(CONFIG, new Uint8Array([1]), 'a.png', 'msg'),
      (err: unknown) =>
        err instanceof GitHubApiError && err.status === 403 && err.message.includes('Resource not accessible'),
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Issue creation
// ---------------------------------------------------------------------------

test('creating an issue returns its number and html url', async () => {
  const { calls, restore } = stubFetch(() => ({
    status: 201,
    body: { number: 42, html_url: 'https://github.com/chpy04/resumix/issues/42' },
  }));

  try {
    const issue = await createIssue(CONFIG, { title: 't', body: 'b', labels: ['feedback', 'bug'] });
    assert.deepEqual(issue, { number: 42, url: 'https://github.com/chpy04/resumix/issues/42' });
  } finally {
    restore();
  }

  assert.equal(calls[0]!.path, '/repos/chpy04/resumix/issues');
  assert.deepEqual(calls[0]!.body!.labels, ['feedback', 'bug']);
});

test('a 422 on labels retries unlabelled instead of losing the report', async () => {
  const { calls, restore } = stubFetch((call) =>
    call.body && 'labels' in call.body
      ? { status: 422, body: { message: 'Validation Failed' } }
      : { status: 201, body: { number: 7, html_url: 'https://github.com/o/r/issues/7' } },
  );

  try {
    const issue = await createIssue(CONFIG, { title: 't', body: 'b', labels: ['nope'] });
    assert.equal(issue.number, 7);
  } finally {
    restore();
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.body!.labels, undefined);
});

test('a non-422 failure is not retried', async () => {
  const { calls, restore } = stubFetch(() => ({ status: 401, body: { message: 'Bad credentials' } }));
  try {
    await assert.rejects(createIssue(CONFIG, { title: 't', body: 'b', labels: [] }), GitHubApiError);
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
});
