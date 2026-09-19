import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  createResumeViaUi,
  extractPdfText,
  findExperienceBullet,
  getResumeDetail,
  login,
  waitForSaved,
} from './support';

/**
 * spec.md: "If I save a resume, and then change the template or content, but
 * click the download button from the home screen, it should give me the
 * version that it was saved with. Whereas if I open the resume again, and
 * click the save button in the top right, it should resave with the new
 * content." This is the anti-drift guarantee, and the trickiest requirement
 * in the brief — tested here as an actual byte-content comparison of two
 * real downloaded PDFs, not just a "some PDF exists" check.
 */
test('the home page download always gives the last-saved snapshot, not live content', async ({
  page,
}) => {
  await login(page);

  const resumeId = await createResumeViaUi(page, `T10 Drift Co ${Date.now()}`);
  const detail = await getResumeDetail(page, resumeId);
  const { bulletId } = findExperienceBullet(detail, 'Unicode', 0);

  const oldMarker = `T10-DRIFT-OLD-${Date.now()}`;
  const newMarker = `T10-DRIFT-NEW-${Date.now()}`;

  await page.getByRole('button', { name: 'Expand Unicode bullets' }).click();
  const bulletRow = page.locator(`[data-testid="bullet-row-${bulletId}"]`);
  await bulletRow.locator('textarea').fill(oldMarker);
  await waitForSaved(page);

  // Save PDF from the editor: this is both the persisted snapshot AND an
  // immediate download of that exact snapshot (see docs/agents/t8.md
  // Deviations — "Save PDF" both POSTs the snapshot and downloads it).
  const firstDownload = await clickSaveAndDownload(page);
  const firstText = await extractPdfText(await fileAsBase64(firstDownload));
  expect(firstText).toContain(oldMarker);

  // Home page: the card's download button should now be enabled.
  await page.goto('/');
  const card = page.locator(`[data-testid="resume-card-${resumeId}"]`);
  const downloadButton = card.locator('[data-testid="resume-download-button"]');
  await expect(downloadButton).toBeEnabled();

  // Change the content again, but do NOT save from the editor this time.
  await page.goto(`/resume/${resumeId}`);
  await page.getByRole('button', { name: 'Expand Unicode bullets' }).click();
  await page.locator(`[data-testid="bullet-row-${bulletId}"]`).locator('textarea').fill(newMarker);
  await waitForSaved(page);

  // Downloading from the home page must still give the OLD snapshot.
  await page.goto('/');
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page
    .locator(`[data-testid="resume-card-${resumeId}"]`)
    .locator('[data-testid="resume-download-button"]')
    .click();
  const homeDownload = await downloadPromise;
  const homeText = await extractPdfText(await fileAsBase64(homeDownload));
  expect(homeText).toContain(oldMarker);
  expect(homeText).not.toContain(newMarker);

  // Re-opening the resume and clicking "Save PDF" again must re-render and
  // persist the NEW content.
  await page.goto(`/resume/${resumeId}`);
  const secondDownload = await clickSaveAndDownload(page);
  const secondText = await extractPdfText(await fileAsBase64(secondDownload));
  expect(secondText).toContain(newMarker);
  expect(secondText).not.toContain(oldMarker);
});

async function clickSaveAndDownload(page: import('@playwright/test').Page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: /save pdf/i }).click();
  return downloadPromise;
}

async function fileAsBase64(download: import('@playwright/test').Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error('download had no local path');
  const bytes = await readFile(path);
  return bytes.toString('base64');
}
