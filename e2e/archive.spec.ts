import { expect, test } from '@playwright/test';
import { createResumeViaUi, findExperienceBullet, getResumeDetail, login, renderResumeText, waitForSaved } from './support';

/**
 * spec.md: "we only ever archive, that way resumes can reference archived
 * things and it is fine. there should be a way to toggle to see archived
 * content, but by default it should be hidden." Archiving is global (like
 * every other content edit); the picker's archived-hiding is a client-side,
 * per-resume-selection-aware concern (docs/DECISIONS.md D-011).
 */
test('archiving a bullet hides it from the default picker view but still renders wherever it was selected', async ({
  page,
}) => {
  await login(page);

  // Resume A keeps the bullet selected; resume B deselects it, so we can
  // prove the "hidden from the picker by default" claim on a resume where
  // it's actually absent, and the "still renders" claim on one where it's
  // still present — without those two claims contradicting each other on
  // the same resume (D-011 deliberately keeps a *selected* archived item
  // visible in the picker too, so it can still be deselected).
  const resumeA = await createResumeViaUi(page, `T10 Archive A ${Date.now()}`);
  const detail = await getResumeDetail(page, resumeA);
  const { bulletId, content } = findExperienceBullet(detail, 'Via Separations (NExT Consulting)', 1);

  const resumeB = await createResumeViaUi(page, `T10 Archive B ${Date.now()}`);
  await page.getByRole('button', { name: 'Expand Via Separations (NExT Consulting) bullets' }).click();
  const bulletRowB = page.locator(`[data-testid="bullet-row-${bulletId}"]`);
  await bulletRowB.getByRole('checkbox', { name: 'Include this bullet on this resume' }).click();
  await waitForSaved(page);
  await expect(bulletRowB.getByRole('checkbox', { name: 'Include this bullet on this resume' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // Archive the bullet (a global edit) from resume A, where it's expanded already.
  await page.goto(`/resume/${resumeA}`);
  await page.getByRole('button', { name: 'Expand Via Separations (NExT Consulting) bullets' }).click();
  const bulletRowA = page.locator(`[data-testid="bullet-row-${bulletId}"]`);
  await bulletRowA.getByRole('button', { name: /^archive/i }).click();
  await waitForSaved(page);

  // Back on resume B (deselected it): with "show archived" off (the
  // default), the bullet must not appear in the picker at all.
  await page.goto(`/resume/${resumeB}`);
  await page.getByRole('button', { name: 'Expand Via Separations (NExT Consulting) bullets' }).click();
  await expect(page.locator(`[data-testid="bullet-row-${bulletId}"]`)).toHaveCount(0);

  // Toggling "show archived" on brings it back, clearly marked archived.
  await page.getByLabel(/show archived/i).check();
  const reappeared = page.locator(`[data-testid="bullet-row-${bulletId}"]`);
  await expect(reappeared).toHaveCount(1);
  await expect(reappeared.getByText('Archived', { exact: true })).toBeVisible();
  await expect(reappeared.getByRole('checkbox', { name: 'Include this bullet on this resume' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // Critically: resume A, which still has the archived bullet selected,
  // still renders it on the PDF — archiving never silently drops content
  // off a resume that already references it.
  const text = await renderResumeText(page, resumeA);
  const distinctiveSubstring = 'PostgreSQL schema with temporal row versioning';
  expect(content).toContain(distinctiveSubstring);
  expect(text).toContain(distinctiveSubstring);
});
