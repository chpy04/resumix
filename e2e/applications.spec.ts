import { expect, test } from '@playwright/test';
import {
  createApplicationViaApi,
  downloadAsBase64,
  extractPdfText,
  findExperienceBullet,
  getDefaultResumeId,
  getResumeDetail,
  login,
  waitForSaved,
} from './support';

/**
 * The loop the app is built around: see a posting, log it, tailor the resume
 * it came with, save that back to the application.
 *
 * The assertion that matters is the last one. A resume is a live selection of
 * global content, so the only honest record of what a company received is the
 * PDF saved against the application — and continuing to edit that resume
 * afterwards, which is the normal thing to do, must not touch it (D-031).
 */
test('a new application brings its own resume, and tailoring it saves back', async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const company = `T-App Loop Co ${stamp}`;
  const sentMarker = `T-APP-SENT-${stamp}`;
  const laterMarker = `T-APP-LATER-${stamp}`;

  // Log it from the board, which is the home page.
  await page.goto('/');
  await page.getByRole('button', { name: 'New application' }).click();
  await page.getByLabel('Company').fill(company);
  await page.getByLabel('Role').fill('Staff Engineer');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page).toHaveURL(/\/applications\/[^/]+$/, { timeout: 15_000 });
  const applicationId = /\/applications\/([^/?#]+)/.exec(page.url())![1]!;
  await expect(page.locator('header').getByText('Draft', { exact: true })).toBeVisible();

  // It arrived with a resume of its own, named after the company.
  await expect(page.getByText(company).first()).toBeVisible();
  await page.getByTestId('application-edit-resume').click();
  await expect(page).toHaveURL(/\/resume\/[^?]+\?application=/, { timeout: 15_000 });

  // In application mode the way back is to the application, not the library.
  await expect(page.getByRole('link', { name: '← Application' })).toBeVisible();

  const resumeId = /\/resume\/([^/?#]+)/.exec(page.url())![1]!;
  const detail = await getResumeDetail(page, resumeId);
  const { bulletId } = findExperienceBullet(detail, 'Unicode', 0);

  await page.getByRole('button', { name: 'Expand Unicode bullets' }).click();
  await page.locator(`[data-testid="bullet-row-${bulletId}"]`).locator('textarea').fill(sentMarker);
  await waitForSaved(page);

  // Saving writes the PDF to the application and lands back on it.
  await page.getByRole('button', { name: 'Save to application' }).click();
  await expect(page).toHaveURL(new RegExp(`/applications/${applicationId}$`), { timeout: 45_000 });
  await expect(page.getByTestId('application-sent-pdf-download')).toBeVisible();

  // Keep working on the resume afterwards — the usual case, not an edge one.
  await page.goto(`/resume/${resumeId}`);
  await page.getByRole('button', { name: 'Expand Unicode bullets' }).click();
  await page
    .locator(`[data-testid="bullet-row-${bulletId}"]`)
    .locator('textarea')
    .fill(laterMarker);
  await waitForSaved(page);

  // The application still holds the bytes it was saved with.
  await page.goto(`/applications/${applicationId}`);
  const download = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('application-sent-pdf-download').click();
  const text = await extractPdfText(await downloadAsBase64(await download));
  expect(text).toContain(sentMarker);
  expect(text).not.toContain(laterMarker);
});

/**
 * Most applications are sent and never touched again, so "applied" is not a
 * board column — it is a searchable table behind its own tab, and marking an
 * application applied is what moves it there.
 */
test('marking an application applied moves it off the pipeline and into the table', async ({
  page,
}) => {
  await login(page);

  const company = `T-App Sent Co ${Date.now()}`;
  const applicationId = await createApplicationViaApi(page, {
    company,
    roleTitle: 'Platform Engineer',
    createResumeFrom: await getDefaultResumeId(page),
  });

  // On the pipeline board while it is still a draft.
  await page.goto('/');
  await expect(page.locator(`[data-testid="application-card-${applicationId}"]`)).toBeVisible();

  await page.goto(`/applications/${applicationId}`);
  await page.getByTestId('application-mark-applied').click();
  await expect(page.locator('header').getByText('Applied', { exact: true })).toBeVisible({
    timeout: 45_000,
  });

  // Off the board...
  await page.goto('/');
  await expect(page.locator(`[data-testid="application-card-${applicationId}"]`)).toHaveCount(0);

  // ...and into the Applied table, with the PDF it was sent with.
  await page.getByRole('tab', { name: /applied/i }).click();
  const row = page.locator(`[data-testid="applied-row-${applicationId}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByText(company)).toBeVisible();

  const download = page.waitForEvent('download', { timeout: 30_000 });
  await row.getByTestId('application-download-button').click();
  const text = await extractPdfText(await downloadAsBase64(await download));
  expect(text).toContain('Northeastern University');

  // A reply arrives: the status picker in the table hands it back to the board.
  await row.getByLabel(`Status for ${company}`).selectOption('interviewing');
  await page.getByRole('tab', { name: /pipeline/i }).click();
  await expect(page.locator(`[data-testid="application-card-${applicationId}"]`)).toBeVisible();
});
