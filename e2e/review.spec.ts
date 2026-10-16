import { expect, test, type Request } from '@playwright/test';
import {
  addCoverLetterViaApi,
  createApplicationViaApi,
  getApplicationDetail,
  getDefaultResumeId,
  getResumeDetail,
  login,
  setApplicationPipelineState,
} from './support';

/**
 * The review flow (D-044): a Needs review card opens the review page, the
 * resume and the letter are approved in turn, and final approval makes the
 * application Ready and copies the command that hands it to the applying
 * agent. Then an edit to the resume reopens it, and only the resume.
 *
 * Flow states and the agent's pick are written straight to the row, because
 * the API refuses both by design (D-041).
 */

test('review → approve → ready, then an edit reopens the resume', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);

  const stamp = Date.now();
  const defaultResumeId = await getDefaultResumeId(page);
  const appId = await createApplicationViaApi(page, {
    company: `T-Review Google ${stamp}`,
    roleTitle: 'FDE intern',
    createResumeFrom: defaultResumeId,
  });
  await addCoverLetterViaApi(page, appId);
  const { resumeId } = await getApplicationDetail(page, appId);
  if (!resumeId) throw new Error('the application has no resume');

  // The agent's pick is the resume as it stands, so Reset has somewhere to go.
  const resume = await getResumeDetail(page, resumeId);
  const proposed = resume.selections;
  const experienceId = proposed.experiences[0];
  const bulletId = experienceId ? proposed.experienceBullets[experienceId]?.[0] : undefined;
  if (!experienceId || !bulletId) throw new Error('Default selects no experience bullet');

  await setApplicationPipelineState(appId, {
    status: 'needs_review',
    fitScore: 4.3,
    agentSummary: `Strong match on customer-facing work ${stamp}.\nWeaker on frontend.`,
    proposedSelection: proposed,
  });

  // Every load of this resume the page starts, so the test can wait for all
  // of them before its first click. `next dev` runs the editor's load effect
  // twice (StrictMode), and a click made between the two answers is what an
  // unguarded late answer would undo.
  let loadsInFlight = 0;
  const isLoad = (request: Request) =>
    request.method() === 'GET' && new URL(request.url()).pathname === `/api/resumes/${resumeId}`;
  page.on('request', (request) => {
    if (isLoad(request)) loadsInFlight++;
  });
  const settled = (request: Request) => {
    if (isLoad(request)) loadsInFlight--;
  };
  page.on('requestfinished', settled);
  page.on('requestfailed', settled);

  // The board sends a Needs review card to the review page.
  await page.goto('/');
  const card = page.getByTestId(`application-card-${appId}`);
  await expect(card.getByTestId('application-review-chip')).toHaveText('Review →');
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/applications/${appId}/review$`));

  await expect(page.getByTestId('review-status')).toHaveText('Needs review');
  await expect(page.getByText(`Strong match on customer-facing work ${stamp}.`)).toBeVisible();
  await expect(page.getByTestId('review-step-resume')).toHaveText('1 Resume');
  await expect(page.getByTestId('review-step-coverLetter')).toHaveText('2 Cover letter');
  await expect(page.getByTestId('review-step-approve')).toHaveText('3 Approve');

  // Step 1: the agent's picks are badged, unticked or not.
  const experienceRow = page.getByTestId(`content-row-${experienceId}`);
  await expect(experienceRow.getByText('agent pick', { exact: true }).first()).toBeVisible();
  // The row showing means a load has landed; wait out any other still in flight.
  await expect.poll(() => loadsInFlight).toBe(0);
  await experienceRow.getByRole('button', { name: /^Expand .* bullets$/ }).click();
  const bulletRow = page.getByTestId(`bullet-row-${bulletId}`);
  await expect(bulletRow.getByText('agent pick', { exact: true })).toBeVisible();

  const selectionsPut = () =>
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().endsWith(`/api/resumes/${resumeId}/selections`),
    );

  let saved = selectionsPut();
  await bulletRow.getByRole('checkbox').click();
  expect((await saved).ok()).toBe(true);
  await expect(bulletRow.getByText('agent pick', { exact: true })).toBeVisible();

  // Reset puts back exactly what the agent proposed.
  await page.getByRole('button', { name: 'Reset to agent pick' }).click();
  await expect
    .poll(async () => (await getResumeDetail(page, resumeId)).selections)
    .toEqual(proposed);
  await expect(page.getByRole('button', { name: "Already the agent's pick" })).toBeDisabled();

  await page.getByRole('button', { name: 'Approve resume' }).click();
  await expect(page.getByTestId('review-step-resume')).toHaveText('1 Resume – ok');

  // Step 2 opens on its own: the letter's text beside its PDF, approved the same way.
  await page.getByRole('button', { name: 'Approve letter' }).click();
  await expect(page.getByTestId('review-step-coverLetter')).toHaveText('2 Cover letter – ok');

  // Step 3.
  await expect(page.getByTestId('approve-row-resume')).toContainText('approved ✓');
  await expect(page.getByTestId('approve-row-coverLetter')).toContainText('approved ✓');
  await page.getByRole('button', { name: 'Approve + copy command' }).click();

  const command = `/resumix-apply ${appId}`;
  await expect(page.getByTestId('apply-command-copied')).toHaveText(`Copied: ${command}`, {
    timeout: 60_000,
  });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  await expect(page.getByTestId('review-status')).toHaveText('Ready');
  await expect(page.getByText(/^Approved .* · Ready$/)).toBeVisible();

  const ready = await getApplicationDetail(page, appId);
  expect(ready.status).toBe('ready');
  expect(ready.approvedAt).not.toBeNull();
  expect(ready.sentPdf?.filename).toMatch(/_Resume\.pdf$/);
  const letterFiles = ready.files.filter((f) => f.filename.endsWith('_Cover_Letter.pdf'));
  expect(letterFiles.map((f) => [f.contentType, f.isArchived])).toEqual([
    ['application/pdf', false],
  ]);

  // An edit after approval reopens the resume, and only the resume.
  await page.getByTestId('review-step-resume').click();
  await expect(page.getByText('✓ Resume approved')).toBeVisible();
  saved = selectionsPut();
  await bulletRow.getByRole('checkbox').click();
  expect((await saved).ok()).toBe(true);

  await expect(page.getByTestId('review-step-resume')).toHaveText('1 Resume');
  await expect(page.getByTestId('review-status')).toHaveText('Needs review');
  await expect(page.getByText('You changed this after approving it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve resume' })).toBeVisible();

  const reopened = await getApplicationDetail(page, appId);
  expect(reopened.status).toBe('needs_review');
  expect(reopened.resumeApprovedAt).toBeNull();
  expect(reopened.approvedAt).toBeNull();
  expect(reopened.coverLetterApprovedAt).not.toBeNull();
  // The pinned snapshot stays until the next final approval.
  expect(reopened.sentPdf?.filename).toBe(ready.sentPdf?.filename);
});

test('without a Clipboard API the command is shown, selected, to copy by hand', async ({
  page,
}) => {
  // What an insecure context looks like: no navigator.clipboard at all.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });
  await login(page);

  const defaultResumeId = await getDefaultResumeId(page);
  const appId = await createApplicationViaApi(page, {
    company: `T-Review Fallback ${Date.now()}`,
    createResumeFrom: defaultResumeId,
  });
  await setApplicationPipelineState(appId, { status: 'needs_review' });

  await page.goto(`/applications/${appId}/review`);
  // No letter, so no letter step: Approve is step 2.
  await expect(page.getByTestId('review-step-approve')).toHaveText('2 Approve');
  await expect(page.getByTestId('review-step-coverLetter')).toHaveCount(0);

  await page.getByRole('button', { name: 'Approve resume' }).click();
  await expect(page.getByTestId('approve-row-resume')).toContainText('approved ✓');
  await page.getByRole('button', { name: 'Approve + copy command' }).click();

  const fallback = page.getByTestId('apply-command-fallback');
  await expect(fallback).toContainText(
    "Couldn't copy automatically — select the command and copy it:",
    { timeout: 60_000 },
  );
  const field = fallback.getByRole('textbox', { name: 'Apply command' });
  await expect(field).toHaveValue(`/resumix-apply ${appId}`);
  await expect(field).toBeFocused();
  // No API means no Copy button to try again with.
  await expect(fallback.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('apply-command-copied')).toHaveCount(0);
  await expect(page.getByTestId('review-status')).toHaveText('Ready');
});
