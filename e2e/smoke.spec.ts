import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'e2e-password';

async function login(page: Page) {
  await page.goto('/');
  const field = page.getByPlaceholder('Password');
  if (await field.isVisible().catch(() => false)) {
    await field.fill(PASSWORD);
    await page.keyboard.press('Enter');
  }
}

test('password gate rejects a wrong password and accepts the right one', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Password').fill('not-the-password');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/wrong password/i)).toBeVisible();

  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.getByPlaceholder('Password')).toBeHidden();
});

test('home page shows the seeded Default resume and a new-resume cell', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Default').first()).toBeVisible();
  await expect(page.getByText(/new resume/i).first()).toBeVisible();
});

test('the editor loads the Default resume with its seeded content', async ({ page }) => {
  await login(page);
  await page.getByText('Default').first().click();
  await expect(page).toHaveURL(/\/resume\//);

  // Content fields are editable inputs, so assert on their values, not on text.
  await expect(page.locator('input[value="Northeastern Electric Racing"]')).toBeVisible();
  await expect(page.locator('input[value="Mentor Matcher"]')).toBeVisible();
  await expect(page.locator('input[value="Languages"]')).toBeVisible();

  // The seeded Default resume has every piece of content selected, so the only
  // unchecked box on the page is the "Show archived" toggle.
  await expect(page.getByRole('checkbox', { checked: false })).toHaveCount(1);
  await expect(page.getByLabel(/show archived/i)).not.toBeChecked();
});

test('both editor tabs are present', async ({ page }) => {
  await login(page);
  await page.getByText('Default').first().click();
  await expect(page.getByRole('tab', { name: /content/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /template/i })).toBeVisible();
});
