import { expect, test } from '@playwright/test';
import { createResumeViaUi, dragRowAbove, findExperienceId, getResumeDetail, login, waitForSaved } from './support';

/**
 * spec.md: "Changing the order... should be saved only to the currently
 * opened resume... Saves should happen automatically." This drives the real
 * `@dnd-kit` drag (see `dragRowAbove` in ./support.ts for why mouse, not
 * keyboard — no `KeyboardSensor` is registered in this app) and checks the
 * new order survives a full page reload.
 */
test('drag-and-drop reordering an experience persists across a reload', async ({ page }) => {
  await login(page);

  const resumeId = await createResumeViaUi(page, `T10 Reorder Co ${Date.now()}`);
  const detail = await getResumeDetail(page, resumeId);
  const unicodeId = findExperienceId(detail, 'Unicode');
  const viaSeparationsId = findExperienceId(detail, 'Via Separations (NExT Consulting)');

  // Seeded order is [Via Separations, Northeastern Electric Racing, Unicode].
  const experiencesSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Experiences', exact: true }) });
  const companyInputs = experiencesSection.locator('[data-testid^="content-row-"] input').first();
  await expect(companyInputs).toBeVisible();

  async function currentOrder(): Promise<string[]> {
    const rows = experiencesSection.locator('[data-testid^="content-row-"]');
    const count = await rows.count();
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
      values.push(await rows.nth(i).locator('input').first().inputValue());
    }
    return values;
  }

  await expect
    .poll(currentOrder)
    .toEqual(['Via Separations (NExT Consulting)', 'Northeastern Electric Racing', 'Unicode']);

  // Drag "Unicode" (last) above "Via Separations..." (first).
  await dragRowAbove(page, unicodeId, viaSeparationsId);

  await expect.poll(currentOrder).toEqual(['Unicode', 'Via Separations (NExT Consulting)', 'Northeastern Electric Racing']);
  await waitForSaved(page);

  // The reorder is an immediate (0ms-debounce) autosave — confirm the server
  // actually has the new order before reloading, so a flaky UI-only result
  // can't slip through as a false pass.
  await expect.poll(async () => (await getResumeDetail(page, resumeId)).selections.experiences).toEqual([
    unicodeId,
    viaSeparationsId,
    detail.library.experiences.find((e) => e.company === 'Northeastern Electric Racing')!.id,
  ]);

  await page.reload();
  await expect(page.getByRole('tab', { name: /content/i })).toBeVisible();
  await expect.poll(currentOrder).toEqual(['Unicode', 'Via Separations (NExT Consulting)', 'Northeastern Electric Racing']);
});
