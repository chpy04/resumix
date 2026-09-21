import { expect, test } from '@playwright/test';
// The shared helper, not a local copy: it waits for the gate to clear before
// returning, so a `goto` straight afterwards cannot abort the login request.
import { login, PASSWORD } from './support';

test('password gate rejects a wrong password and accepts the right one', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Password').fill('not-the-password');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/wrong password/i)).toBeVisible();

  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.getByPlaceholder('Password')).toBeHidden();
});

test('the home page is the applications board', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /pipeline/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /applied/i })).toBeVisible();
});

test('the resume library shows the seeded Default resume and a new-resume cell', async ({
  page,
}) => {
  await login(page);
  await page.goto('/resumes');
  await expect(page.getByText('Default').first()).toBeVisible();
  await expect(page.getByText(/new resume/i).first()).toBeVisible();
});

test('the editor loads the Default resume with its seeded content', async ({ page }) => {
  await login(page);
  await page.goto('/resumes');
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
  await page.goto('/resumes');
  await page.getByText('Default').first().click();
  await expect(page.getByRole('tab', { name: /content/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: /template/i })).toBeVisible();
});
