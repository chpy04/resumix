import { expect, test } from '@playwright/test';
import { createResumeViaUi, findExperienceId, getResumeDetail, login, renderResumeText, waitForSaved } from './support';

/**
 * spec.md: "Changing the order or selecting / deselecting content should be
 * saved only to the currently opened resume." This is the per-resume half of
 * the single most important conceptual distinction in the app.
 */
test('deselecting content on one resume does not affect other resumes, and drops off that resume\'s PDF', async ({
  page,
}) => {
  await login(page);

  const resumeId = await createResumeViaUi(page, `T10 Scope Co ${Date.now()}`);

  // Deselect the "Unicode" experience on this resume only.
  const toggle = page.getByRole('checkbox', { name: 'Include Unicode on this resume' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await waitForSaved(page);

  // The Default resume (a different resume) must still have it selected.
  const resumes = await page.evaluate(async () => {
    const token = window.localStorage.getItem('resumix.token');
    const res = await fetch('/api/resumes', { headers: { 'x-resumix-token': token ?? '' } });
    return (await res.json()) as { id: string; isDefault: boolean }[];
  });
  const defaultResume = resumes.find((r) => r.isDefault);
  expect(defaultResume).toBeTruthy();

  await page.goto(`/resume/${defaultResume!.id}`);
  const defaultToggle = page.getByRole('checkbox', { name: 'Include Unicode on this resume' });
  await expect(defaultToggle).toHaveAttribute('aria-checked', 'true');

  // Server-side confirmation: the new resume's selections no longer include
  // Unicode's experience id; the Default resume's still does.
  const [newDetail, defaultDetail] = await Promise.all([
    getResumeDetail(page, resumeId),
    getResumeDetail(page, defaultResume!.id),
  ]);
  const unicodeId = findExperienceId(defaultDetail, 'Unicode');
  expect(newDetail.selections.experiences).not.toContain(unicodeId);
  expect(defaultDetail.selections.experiences).toContain(unicodeId);

  // And the rendered PDF for the resume that deselected it no longer
  // contains that experience's content, while the Default resume's still
  // does. Checked by company name (the experience heading), not bullet
  // text, so this assertion doesn't depend on any particular bullet's
  // wording staying fixed across other, independently-run spec files that
  // are free to edit bullet content globally.
  const [newText, defaultText] = await Promise.all([
    renderResumeText(page, resumeId),
    renderResumeText(page, defaultResume!.id),
  ]);
  expect(newText).not.toContain('Unicode');
  expect(defaultText).toContain('Unicode');
});
