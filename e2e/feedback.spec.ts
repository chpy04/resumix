import { expect, test, type Page } from '@playwright/test';
import { login } from './support.ts';

/**
 * The GitHub call itself is stubbed at the network boundary: the assertion
 * worth making here is that the widget collects the right four things (kind,
 * description, page URL, screenshot) and puts them on the wire. Actually
 * filing an issue would need a live token and would litter the real repo,
 * and `lib/feedback/github.test.ts` already covers the request sequence.
 */

const STUB_ISSUE = {
  number: 123,
  url: 'https://github.com/chpy04/resumix/issues/123',
  screenshotUploaded: true,
};

// A 1x1 PNG — small enough to inline, real enough for an `image/png` input.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Intercepts `POST /api/feedback` and returns the captured request body. */
async function stubFeedbackApi(page: Page): Promise<() => string> {
  let captured = '';
  await page.route('**/api/feedback', async (route) => {
    captured = route.request().postDataBuffer()?.toString('latin1') ?? '';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(STUB_ISSUE),
    });
  });
  return () => captured;
}

test('a bug report carries the description, the current URL, and the screenshot', async ({
  page,
}) => {
  await login(page);
  const body = await stubFeedbackApi(page);

  await page.getByRole('button', { name: /give feedback/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Bug is the default selection, and the two circles are mutually exclusive.
  await expect(dialog.getByRole('radio', { name: 'Bug' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Feature request' })).not.toBeChecked();

  // The page being reported on is captured without the user doing anything.
  await expect(dialog.getByText('http://localhost:3100/')).toBeVisible();

  await dialog.getByRole('textbox').fill('The download button does nothing on the Default card.');
  await dialog
    .getByTestId('feedback-screenshot-input')
    .setInputFiles({ name: 'bug.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(dialog.getByText('bug.png')).toBeVisible();

  await dialog.getByRole('button', { name: 'Send feedback' }).click();

  const issueLink = dialog.getByRole('link', { name: 'issue #123' });
  await expect(issueLink).toBeVisible();
  await expect(issueLink).toHaveAttribute('href', STUB_ISSUE.url);

  const sent = body();
  expect(sent).toContain('name="kind"');
  expect(sent).toContain('bug');
  expect(sent).toContain('The download button does nothing on the Default card.');
  expect(sent).toContain('http://localhost:3100/');
  expect(sent).toContain('filename="bug.png"');
});

test('a feature request from the editor records that page, not the home page', async ({ page }) => {
  await login(page);
  await page.getByText('Default').first().click();
  await expect(page).toHaveURL(/\/resume\//);
  const editorUrl = page.url();

  const body = await stubFeedbackApi(page);

  await page.getByRole('button', { name: /give feedback/i }).click();
  const dialog = page.getByRole('dialog');

  await dialog.getByText('Feature request').click();
  await expect(dialog.getByRole('radio', { name: 'Feature request' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Bug' })).not.toBeChecked();

  await dialog.getByRole('textbox').fill('Let me duplicate a resume from the editor header.');
  await dialog.getByRole('button', { name: 'Send feedback' }).click();
  await expect(dialog.getByRole('link', { name: 'issue #123' })).toBeVisible();

  const sent = body();
  expect(sent).toContain('feature');
  expect(sent).toContain(editorUrl);
  // Nothing was attached, so no file part should be on the wire.
  expect(sent).not.toContain('name="screenshot"');
});

test('feedback cannot be sent empty, and is not offered before login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByPlaceholder('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: /give feedback/i })).toBeHidden();

  await login(page);
  await page.getByRole('button', { name: /give feedback/i }).click();
  const dialog = page.getByRole('dialog');

  const send = dialog.getByRole('button', { name: 'Send feedback' });
  await expect(send).toBeDisabled();
  await dialog.getByRole('textbox').fill('   ');
  await expect(send).toBeDisabled();
  await dialog.getByRole('textbox').fill('Something real.');
  await expect(send).toBeEnabled();

  // Escape closes without filing anything.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
