import { expect, test } from '@playwright/test';
import { createResumeViaUi, login } from './support';

/**
 * spec.md: "download a pdf, which should save the resume in the format
 * 'Chris_Pyle_<company name>_Resume.pdf', with the company name
 * automatically snaked cased and first letter of each word capitalized,
 * regardless of what I wrote as the title."
 */
test('the downloaded filename is snake_cased and title_cased regardless of how the name was typed', async ({
  page,
}) => {
  await login(page);

  // Mixed case, extra internal whitespace, and a trailing timestamp to keep
  // resume names unique across test runs against the same seeded database.
  const stamp = Date.now();
  const companyName = `acme WIDGETS   robotics ${stamp}`;
  await createResumeViaUi(page, companyName);

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: /save pdf/i }).click();
  const download = await downloadPromise;

  const expected = `Chris_Pyle_Acme_Widgets_Robotics_${stamp}_Resume.pdf`;
  expect(download.suggestedFilename()).toBe(expected);
});
