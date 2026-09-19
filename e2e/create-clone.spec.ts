import { expect, test } from '@playwright/test';
import { createResumeViaUi, getResumeDetail, login } from './support';

/**
 * spec.md: "In the top left should be a blank one that I can click to create
 * a new resume... [the Default resume] also serves as a starting point
 * whenever I make a new Resume."
 */
test('creating a resume clones the Default resume as a starting point', async ({ page }) => {
  await login(page);

  const company = `T10 Clone Co ${Date.now()}`;
  const resumeId = await createResumeViaUi(page, company);

  // Same seeded content, editable inputs (per smoke.spec.ts's convention).
  await expect(page.locator('input[value="Northeastern Electric Racing"]')).toBeVisible();
  await expect(page.locator('input[value="Mentor Matcher"]')).toBeVisible();
  await expect(page.locator('input[value="Languages"]')).toBeVisible();

  // Everything the Default resume selects should start selected here too —
  // the only unchecked box on the page is "Show archived" (same assertion
  // smoke.spec.ts makes about the Default resume itself).
  await expect(page.getByRole('checkbox', { checked: false })).toHaveCount(1);
  await expect(page.getByLabel(/show archived/i)).not.toBeChecked();

  // Confirm via the API too: the new resume's Selections should be a
  // structurally identical clone of the Default resume's.
  const resumes = await page.evaluate(async () => {
    const token = window.localStorage.getItem('resumix.token');
    const res = await fetch('/api/resumes', { headers: { 'x-resumix-token': token ?? '' } });
    return (await res.json()) as { id: string; isDefault: boolean }[];
  });
  const defaultResume = resumes.find((r) => r.isDefault);
  expect(defaultResume).toBeTruthy();

  const [newDetail, defaultDetail] = await Promise.all([
    getResumeDetail(page, resumeId),
    getResumeDetail(page, defaultResume!.id),
  ]);

  expect(new Set(newDetail.selections.experiences)).toEqual(new Set(defaultDetail.selections.experiences));
  expect(new Set(newDetail.selections.projects)).toEqual(new Set(defaultDetail.selections.projects));
  expect(new Set(newDetail.selections.skillRows)).toEqual(new Set(defaultDetail.selections.skillRows));
});
