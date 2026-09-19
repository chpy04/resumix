import { expect, test } from '@playwright/test';
import {
  createResumeViaUi,
  findExperienceBullet,
  getResumeDetail,
  login,
  waitForSaved,
} from './support';

/**
 * spec.md: "editing content (creating, updating, or archiving), should be a
 * global change that effects all resumes." This is called out in the task
 * brief as "the single most important behavioral claim in the spec."
 */
test('editing a bullet on one resume is visible on every other resume that selected it', async ({
  page,
}) => {
  await login(page);

  const resumeA = await createResumeViaUi(page, `T10 Global A ${Date.now()}`);
  const detail = await getResumeDetail(page, resumeA);
  const { bulletId, content: originalContent } = findExperienceBullet(
    detail,
    'Northeastern Electric Racing',
    0,
  );

  const marker = `T10-GLOBAL-EDIT-MARKER-${Date.now()}`;
  const newContent = `${marker} — edited from resume A`;

  // Expand the experience and edit the bullet's text on resume A.
  await page.getByRole('button', { name: 'Expand Northeastern Electric Racing bullets' }).click();
  const bulletRow = page.locator(`[data-testid="bullet-row-${bulletId}"]`);
  const textarea = bulletRow.locator('textarea');
  await expect(textarea).toHaveValue(originalContent);
  await textarea.fill(newContent);
  await waitForSaved(page);

  // A second, independently created resume that also selected this bullet
  // (every new resume clones every selection from Default) must see the new
  // text — not the old one — because content edits are global, not scoped
  // to resume A.
  const resumeB = await createResumeViaUi(page, `T10 Global B ${Date.now()}`);
  await page.getByRole('button', { name: 'Expand Northeastern Electric Racing bullets' }).click();
  const bulletRowB = page.locator(`[data-testid="bullet-row-${bulletId}"]`);
  await expect(bulletRowB.locator('textarea')).toHaveValue(newContent);
  await expect(bulletRowB.locator('textarea')).not.toHaveValue(originalContent);

  // Confirm server-side too, straight from the shared library.
  const detailB = await getResumeDetail(page, resumeB);
  const bulletInLibrary = detailB.library.experiences
    .find((e) => e.company === 'Northeastern Electric Racing')!
    .bullets.find((b) => b.id === bulletId);
  expect(bulletInLibrary?.content).toBe(newContent);
});
