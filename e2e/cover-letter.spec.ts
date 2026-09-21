import { expect, test } from '@playwright/test';
import { createApplicationViaApi, downloadAsBase64, extractPdfText, login } from './support';

/**
 * The cover letter half of the application loop: add one, write it, download
 * what you wrote.
 *
 * The assertion that matters is the last pair. A cover letter has no PDF
 * snapshot behind it — the download compiles the stored text every time — so
 * the promise being tested is the opposite of the resume's: what comes out
 * must reflect the *current* letter, and editing one letter must not touch
 * any other (D-035).
 */
test('an application gets its own cover letter, and editing it is not global', async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const company = `T-CL Loop Co ${stamp}`;
  const marker = `T-CL-WRITTEN-${stamp}`;

  const applicationId = await createApplicationViaApi(page, { company, roleTitle: 'Engineer' });
  await page.goto(`/applications/${applicationId}`);

  // Nothing is attached until you ask for one — plenty of postings never do.
  const addButton = page.getByTestId('application-add-cover-letter');
  await expect(addButton).toBeVisible();
  await addButton.click();

  // Adding copies the Default letter under the company's name.
  const editLink = page.getByTestId('application-edit-cover-letter');
  await expect(editLink).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(company).first()).toBeVisible();

  await editLink.click();
  await expect(page).toHaveURL(/\/cover-letter\/[^?]+\?application=/, { timeout: 15_000 });
  const coverLetterId = /\/cover-letter\/([^/?#]+)/.exec(page.url())![1]!;

  // In application mode the way back is to the application, as on the resume.
  await expect(page.getByRole('link', { name: '← Application' })).toBeVisible();

  // The editor holds the whole document, and the preview compiles it.
  const editor = page.getByLabel('Cover letter LaTeX');
  await expect(editor).toHaveValue(/\\documentclass/, { timeout: 15_000 });
  const body = await editor.inputValue();
  await editor.fill(body.replace('Dear Hiring Team,', `Dear Hiring Team, ${marker}`));
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  // The download is a fresh compile of the saved text, not a stored snapshot.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const text = await extractPdfText(await downloadAsBase64(await downloadPromise));
  expect(text).toContain(marker);

  // The Default letter it was copied from is untouched — the whole point of
  // storing the text per letter rather than sharing it.
  await page.goto('/cover-letters');
  const defaultCard = page.locator('[data-testid^="cover-letter-card-"]').filter({
    hasText: 'Default',
  });
  await expect(defaultCard.first()).toBeVisible({ timeout: 15_000 });
  await defaultCard.first().click();
  await expect(page).toHaveURL(/\/cover-letter\//, { timeout: 15_000 });
  expect(/\/cover-letter\/([^/?#]+)/.exec(page.url())![1]).not.toEqual(coverLetterId);
  await expect(page.getByLabel('Cover letter LaTeX')).not.toHaveValue(new RegExp(marker));
});
