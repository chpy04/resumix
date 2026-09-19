import { expect, test } from '@playwright/test';
import { createResumeViaApi, login } from './support';

/**
 * spec.md: "I should also be able to fuzzy search over these resumes...
 * In the top left should be a blank one that I can click to create a new
 * resume. Immediately to the right of the blank one should be my 'Default'
 * Resume" — i.e. search filters the grid but never hides the two pinned
 * cells.
 */
test('fuzzy search filters the resume grid while keeping the new-resume and Default cells pinned', async ({
  page,
}) => {
  await login(page);

  // A token with forced digits: fuzzy matching is subsequence-based, so a
  // digit that has to appear in-order guarantees no letters-only resume
  // name (like the unrelated one below) can accidentally match it.
  const token = `zx9${Math.random().toString(36).slice(2, 6)}q7`;
  const nameA = `Zeta ${token} Corp`;
  const nameB = `Zeta ${token} Labs`;
  const unrelatedName = `Omicron Widgets Consulting Group ${Date.now()}`;
  await createResumeViaApi(page, nameA);
  await createResumeViaApi(page, nameB);
  await createResumeViaApi(page, unrelatedName);

  await page.goto('/');
  await expect(page.getByText(nameA)).toBeVisible();
  await expect(page.getByText(nameB)).toBeVisible();
  await expect(page.getByText(unrelatedName)).toBeVisible();

  await page.getByLabel('Search resumes').fill(token);

  await expect(page.getByText(nameA)).toBeVisible();
  await expect(page.getByText(nameB)).toBeVisible();
  // Pinned cells stay, regardless of the query.
  await expect(page.getByText(/new resume/i).first()).toBeVisible();
  await expect(page.getByText('Default').first()).toBeVisible();
  // An unrelated resume name is filtered out of the grid.
  await expect(page.getByText(unrelatedName)).toHaveCount(0);

  await page.getByLabel('Search resumes').fill('');
  await expect(page.getByText(nameA)).toBeVisible();
  await expect(page.getByText(nameB)).toBeVisible();
  await expect(page.getByText(unrelatedName)).toBeVisible();
});
