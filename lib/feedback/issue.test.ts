import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extensionForMimeType,
  issueBody,
  issueLabels,
  issueTitle,
  screenshotPath,
} from './issue.ts';

const AT = new Date('2026-09-19T15:04:05.123Z');

test('the title is prefixed with the kind', () => {
  assert.equal(issueTitle('bug', 'Preview flickers'), '[Bug] Preview flickers');
  assert.equal(issueTitle('feature', 'Add dark mode'), '[Feature] Add dark mode');
});

test('the title uses only the first non-empty line of the description', () => {
  assert.equal(issueTitle('bug', '\n\nFirst line\nsecond line'), '[Bug] First line');
});

test('a long first line is truncated on a word boundary', () => {
  const title = issueTitle(
    'bug',
    'a'.repeat(10) +
      ' ' +
      'the preview pane keeps flickering every single time I type a character into the editor',
  );
  assert.ok(title.length <= '[Bug] '.length + 72, title);
  assert.ok(title.endsWith('…'));
  assert.ok(!title.includes('  '));
});

test('a single unbroken word is hard-truncated rather than emptied', () => {
  const title = issueTitle('bug', 'x'.repeat(200));
  assert.ok(title.startsWith('[Bug] xxx'));
  assert.ok(title.endsWith('…'));
});

test('a whitespace-only description still produces a usable title', () => {
  assert.equal(issueTitle('feature', '   \n  '), '[Feature] In-app feedback');
});

test('labels carry both the source and the kind', () => {
  assert.deepEqual(issueLabels('bug'), ['feedback', 'bug']);
  assert.deepEqual(issueLabels('feature'), ['feedback', 'enhancement']);
});

test('the body leads with the type and the page url', () => {
  const body = issueBody({
    kind: 'bug',
    description: 'It broke.',
    url: 'https://resumix.app/resume/abc',
    submittedAt: AT,
  });
  const lines = body.split('\n');
  assert.equal(lines[0], '**Type:** Bug report');
  assert.ok(lines[1]!.includes('https://resumix.app/resume/abc'));
  assert.ok(body.includes('It broke.'));
});

test('the description is passed through unescaped', () => {
  // Same reasoning as D-008: the author meant the markdown they typed.
  const body = issueBody({
    kind: 'bug',
    description: '`\\textbf{Bold}` renders as **literal** text',
    url: 'https://resumix.app/',
    submittedAt: AT,
  });
  assert.ok(body.includes('`\\textbf{Bold}` renders as **literal** text'));
});

test('parentheses in the url are encoded so the markdown link cannot break', () => {
  const body = issueBody({
    kind: 'bug',
    description: 'x',
    url: 'https://resumix.app/resume/a(b)c',
    submittedAt: AT,
  });
  assert.ok(body.includes('(https://resumix.app/resume/a%28b%29c)'));
});

test('a screenshot url becomes an inline image', () => {
  const body = issueBody({
    kind: 'bug',
    description: 'x',
    url: 'https://resumix.app/',
    screenshotUrl: 'https://raw.githubusercontent.com/o/r/sha/screenshots/a.png',
    submittedAt: AT,
  });
  assert.ok(
    body.includes('![screenshot](https://raw.githubusercontent.com/o/r/sha/screenshots/a.png)'),
  );
});

test('a failed screenshot upload is reported in the body instead of dropped', () => {
  const body = issueBody({
    kind: 'bug',
    description: 'x',
    url: 'https://resumix.app/',
    screenshotError: 'GitHub 403 on /git/blobs',
    submittedAt: AT,
  });
  assert.ok(body.includes('could not be uploaded: GitHub 403 on /git/blobs'));
  assert.ok(!body.includes('![screenshot]'));
});

test('the environment block carries the submission context', () => {
  const body = issueBody({
    kind: 'feature',
    description: 'x',
    url: 'https://resumix.app/',
    viewport: '1512x857',
    userAgent: 'Mozilla/5.0',
    submittedAt: AT,
  });
  assert.ok(body.includes('- Submitted: 2026-09-19T15:04:05.123Z'));
  assert.ok(body.includes('- Viewport: 1512x857'));
  assert.ok(body.includes('- User agent: `Mozilla/5.0`'));
});

test('backticks in a user agent cannot escape the code span', () => {
  const body = issueBody({
    kind: 'bug',
    description: 'x',
    url: 'https://resumix.app/',
    userAgent: 'Evil/1.0` **bold**',
    submittedAt: AT,
  });
  assert.ok(body.includes('- User agent: `Evil/1.0 **bold**`'));
});

test('only image types GitHub renders inline are accepted', () => {
  assert.equal(extensionForMimeType('image/png'), 'png');
  assert.equal(extensionForMimeType('image/jpeg'), 'jpg');
  assert.equal(extensionForMimeType('IMAGE/PNG'), 'png');
  assert.equal(extensionForMimeType('image/png; charset=binary'), 'png');
  assert.equal(extensionForMimeType('application/pdf'), null);
  assert.equal(extensionForMimeType('image/tiff'), null);
});

test('screenshot paths are date-partitioned and collision-resistant', () => {
  const path = screenshotPath('png', AT, 'abcdef12-3456-7890-abcd-ef1234567890');
  assert.equal(path, 'screenshots/2026/09/2026-09-19T15-04-05-123Z-abcdef12.png');
});

test('two screenshots in the same millisecond get different paths', () => {
  const a = screenshotPath('png', AT, '11111111-aaaa-bbbb-cccc-dddddddddddd');
  const b = screenshotPath('png', AT, '22222222-aaaa-bbbb-cccc-dddddddddddd');
  assert.notEqual(a, b);
});
