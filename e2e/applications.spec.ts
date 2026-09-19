import { expect, test } from '@playwright/test';
import {
  createResumeViaUi,
  downloadAsBase64,
  extractPdfText,
  findExperienceBullet,
  getResumeDetail,
  login,
  waitForSaved,
} from './support';

/**
 * The promise an application makes: the PDF it was sent with is the PDF it
 * keeps. A resume is a live, mutable selection of global content, so the only
 * honest record of what a company received is the snapshot taken the moment
 * you marked the application applied — and editing that resume afterwards,
 * which is the normal thing to do, must not touch it (D-031).
 *
 * Asserted as text extracted from two real downloaded PDFs, like
 * pdf-drift.spec.ts, rather than "a PDF exists".
 */
test('an application keeps the PDF it was sent with, however the resume changes', async ({
  page,
}) => {
  await login(page);

  const stamp = Date.now();
  const resumeName = `T-App Snapshot Co ${stamp}`;
  const oldMarker = `T-APP-SENT-${stamp}`;
  const newMarker = `T-APP-LATER-${stamp}`;

  // A resume with something distinctive on it.
  const resumeId = await createResumeViaUi(page, resumeName);
  const detail = await getResumeDetail(page, resumeId);
  const { bulletId } = findExperienceBullet(detail, 'Unicode', 0);

  await page.getByRole('button', { name: 'Expand Unicode bullets' }).click();
  await page.locator(`[data-testid="bullet-row-${bulletId}"]`).locator('textarea').fill(oldMarker);
  await waitForSaved(page);

  // Log the application, link that resume, send it.
  await page.goto('/applications');
  await page.getByRole('button', { name: 'New application' }).click();
  await page.getByLabel('Company').fill(`T-App Snapshot Co ${stamp}`);
  await page.getByLabel('Role').fill('Staff Engineer');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page).toHaveURL(/\/applications\/[^/]+$/, { timeout: 15_000 });
  // Scoped to the header: the status <select> also contains an option
  // reading "Draft", and this is asserting the badge.
  await expect(page.locator('header').getByText('Draft', { exact: true })).toBeVisible();

  await page.getByLabel('Resume').selectOption({ label: resumeName });
  await waitForSaved(page);

  await page.getByTestId('application-mark-applied').click();
  await expect(page.locator('header').getByText('Applied', { exact: true })).toBeVisible({
    timeout: 45_000,
  });

  const sentDownload = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('application-sent-pdf-download').click();
  const sentText = await extractPdfText(await downloadAsBase64(await sentDownload));
  expect(sentText).toContain(oldMarker);

  // Keep working on the resume afterwards — the usual case, not an edge one.
  await page.goto(`/resume/${resumeId}`);
  await page.getByRole('button', { name: 'Expand Unicode bullets' }).click();
  await page.locator(`[data-testid="bullet-row-${bulletId}"]`).locator('textarea').fill(newMarker);
  await waitForSaved(page);

  // The board still hands back what was actually sent.
  await page.goto('/applications');
  const card = page.locator('[data-testid^="application-card-"]', {
    hasText: `T-App Snapshot Co ${stamp}`,
  });
  await expect(card).toBeVisible();

  const boardDownload = page.waitForEvent('download', { timeout: 30_000 });
  await card.getByTestId('application-download-button').click();
  const boardText = await extractPdfText(await downloadAsBase64(await boardDownload));
  expect(boardText).toContain(oldMarker);
  expect(boardText).not.toContain(newMarker);
});
