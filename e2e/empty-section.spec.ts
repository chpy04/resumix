import { expect, test } from '@playwright/test';
import { createResumeViaUi, login } from './support';

/**
 * Regression: deselecting every item in a section used to abort the compile with
 * "Something's wrong--perhaps a missing \item", because the template's
 * \begin{itemize} was left with no \item. Sections are now wrapped in
 * <<IF:TOKEN>>...<<ENDIF>> and disappear entirely instead.
 */
test('deselecting every item in a section still renders a PDF', async ({ page }) => {
  // A throwaway resume, not Default — this test strips every selection, and the
  // suite shares one seeded database across tests in a single worker.
  await login(page);
  await createResumeViaUi(page, 'Empty Section Regression');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 45_000 });

  // Turn off every top-level checkbox in the content pane (all experiences,
  // projects and skill rows) — the worst case, an entirely empty resume.
  const boxes = page.getByRole('checkbox');
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    const label = await box.getAttribute('aria-label');
    if (label && /show archived/i.test(label)) continue;
    if (await box.isChecked()) await box.uncheck();
  }

  // The preview must still render, and must not be showing a compile error.
  await expect(page.getByText(/failed to compile/i)).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/empty-sections.png' });
});
