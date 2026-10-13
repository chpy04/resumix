import { expect, test, type Request } from '@playwright/test';
import {
  addCoverLetterViaApi,
  createApplicationViaApi,
  fetchPdfText,
  getApplicationDetail,
  getDefaultResumeId,
  login,
  setApplicationPipelineState,
} from './support';

/**
 * A cover letter as plain text (D-046). Review step 2 edits the letter's
 * body, which Resumix escapes into its Default design, so prose with `&`,
 * `%`, `$` and `#` in it prints as typed. The letter's own page shows the
 * same text on its Body tab and the design, marker and all, on its LaTeX
 * tab. Approving the letter and editing it again reopens it (D-044).
 */
test('review step 2 writes the letter as plain text, and an edit reopens it', async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const marker = `T-BODY-${stamp}`;
  const defaultResumeId = await getDefaultResumeId(page);
  const appId = await createApplicationViaApi(page, {
    company: `T-Body Co ${stamp}`,
    roleTitle: 'FDE intern',
    createResumeFrom: defaultResumeId,
  });
  const letterId = await addCoverLetterViaApi(page, appId);
  await setApplicationPipelineState(appId, { status: 'needs_review' });

  // Every load of the letter the page starts, so the test can wait for all
  // of them before it types: `next dev` runs the editor's load effect twice.
  let loadsInFlight = 0;
  const isLoad = (request: Request) =>
    request.method() === 'GET' &&
    new URL(request.url()).pathname === `/api/cover-letters/${letterId}`;
  page.on('request', (request) => {
    if (isLoad(request)) loadsInFlight++;
  });
  const settled = (request: Request) => {
    if (isLoad(request)) loadsInFlight--;
  };
  page.on('requestfinished', settled);
  page.on('requestfailed', settled);

  await page.goto(`/applications/${appId}/review`);
  const step = page.getByTestId('review-step-coverLetter');
  await expect(step).toHaveText('2 Cover letter');
  await step.click();

  // A letter copied from the Default has no text of its own yet.
  const field = page.getByLabel('Cover letter text');
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('');
  await expect.poll(() => loadsInFlight).toBe(0);

  const bodySaved = () =>
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/cover-letters/${letterId}`),
    );

  const prose = `Dear Hiring Team,\n\nWe ran R&D at 100% for $5 #1, ${marker}.\n\nBest,\nChris`;
  let saved = bodySaved();
  await field.fill(prose);
  expect((await saved).ok()).toBe(true);
  // The resume step stays mounted behind this one, so only what is showing
  // counts.
  await expect(page.getByText('Saved', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('1 page', { exact: true }).filter({ visible: true })).toBeVisible({
    timeout: 30_000,
  });

  // What the download compiles is the shell with the text escaped into it:
  // every special printed, and the marker gone.
  const text = await fetchPdfText(page, `/api/cover-letters/${letterId}/pdf`);
  expect(text).toContain(marker);
  for (const piece of ['Dear Hiring Team,', 'R&D', '100%', '#1', 'Best,', 'Chris']) {
    expect(text).toContain(piece);
  }
  expect(text).not.toContain('%%BODY%%');
  expect(text).not.toContain('\\&');

  await page.getByRole('button', { name: 'Approve letter' }).click();
  await expect(step).toHaveText('2 Cover letter – ok');

  // Editing it after approval brings the approval back to do.
  await step.click();
  await expect(page.getByText('✓ Letter approved')).toBeVisible();
  saved = bodySaved();
  await field.fill(`${prose}\nP.S. One more line.`);
  expect((await saved).ok()).toBe(true);

  await expect(step).toHaveText('2 Cover letter');
  await expect(page.getByText('You changed this after approving it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve letter' })).toBeVisible();
  const reopened = await getApplicationDetail(page, appId);
  expect(reopened.coverLetterApprovedAt).toBeNull();
  expect(reopened.status).toBe('needs_review');

  // The letter's own page: the same text on Body, the design on LaTeX.
  await page.goto(`/cover-letter/${letterId}?application=${appId}`);
  await expect(page.getByRole('tab', { name: 'Body' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Cover letter text')).toHaveValue(new RegExp(marker));
  await page.getByRole('tab', { name: 'LaTeX' }).click();
  await expect(page.getByLabel('Cover letter LaTeX')).toHaveValue(/^[ \t]*%%BODY%%[ \t]*$/m);
});
