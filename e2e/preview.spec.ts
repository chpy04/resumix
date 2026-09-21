import { expect, test, type Page } from '@playwright/test';
import { login } from './support';

async function openDefaultEditor(page: Page) {
  await login(page);
  await page.goto('/resumes');
  await page.getByText('Default').first().click();
  await expect(page).toHaveURL(/\/resume\//);
}

test('the live PDF preview renders the seeded resume', async ({ page }) => {
  await openDefaultEditor(page);
  // react-pdf paints into a canvas once the render round-trips through pdflatex.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/1 page/i).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-content.png', fullPage: false });
});

test('the template tab shows the LaTeX source and the token legend', async ({ page }) => {
  await openDefaultEditor(page);
  await page.getByRole('tab', { name: /template/i }).click();

  const editor = page.locator('textarea');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(/documentclass/);
  await expect(editor).toHaveValue(/<<EXPERIENCES>>/);

  // All four substitution tokens are discoverable from the legend.
  for (const token of ['<<EXPERIENCES>>', '<<PROJECTS>>', '<<SKILLS_TOP>>', '<<SKILLS_BOTTOM>>']) {
    await expect(page.getByText(token, { exact: false }).first()).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/editor-template.png', fullPage: false });
});

test('a broken template shows compile errors without blanking the preview', async ({ page }) => {
  await openDefaultEditor(page);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 45_000 });

  await page.getByRole('tab', { name: /template/i }).click();
  const editor = page.locator('textarea');
  await editor.click();
  await editor.press('End');
  await editor.pressSequentially('\\thisMacroDoesNotExist');

  // The error surfaces, and the previously-rendered PDF stays on screen.
  await expect(page.getByText(/undefined control sequence/i).first()).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-error.png', fullPage: false });
});
