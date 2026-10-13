import { expect, test, type Page, type Request } from '@playwright/test';
import {
  createApplicationViaApi,
  getApplicationDetail,
  getDefaultResumeId,
  insertApplicationQuestions,
  login,
  setApplicationPipelineState,
} from './support';

/**
 * The review's Questions step (D-047): profile answers approved in bulk, an
 * open-ended answer edited and approved, another sent back for a redraft, a
 * choice given as an instruction, a file question answered by an upload, and
 * an EEO question that starts with nothing picked (C10). Final approval waits
 * for the required ones, and an edit afterwards reopens the application.
 *
 * The questions are written straight to the database: only the agent records
 * them, over MCP.
 */

/** The PATCH an answer edit sends, once its debounce has run. */
function answerSaved(page: Page, questionId: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/application-questions/${questionId}`),
  );
}

test('questions: answer, redraft, approve, then an edit reopens it', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);

  const stamp = Date.now();
  const defaultResumeId = await getDefaultResumeId(page);
  // No letter, so the steps are Resume, Questions, Approve.
  const appId = await createApplicationViaApi(page, {
    company: `T-Questions Google ${stamp}`,
    roleTitle: 'FDE intern',
    createResumeFrom: defaultResumeId,
  });
  const { resumeId } = await getApplicationDetail(page, appId);
  await setApplicationPipelineState(appId, { status: 'needs_review' });

  const [nameId, emailId, whyId, projectId, officeId, sampleId, genderId] =
    await insertApplicationQuestions(appId, [
      {
        label: 'Full name',
        kind: 'text',
        required: true,
        source: 'profile',
        proposedAnswer: 'Chris Pyle',
      },
      {
        label: 'Email',
        kind: 'text',
        required: true,
        source: 'profile',
        proposedAnswer: 'chris@example.test',
      },
      {
        label: 'Why Forward Deployed Engineering?',
        kind: 'text',
        required: true,
        proposedAnswer: "I've spent the last year building tools that sit next to their users.",
      },
      {
        label: 'Tell us about a project',
        kind: 'text',
        proposedAnswer: 'I built a resume tool.',
      },
      {
        label: 'Which office?',
        kind: 'choice',
        options: ['NYC', 'SF', 'Boston', 'Remote'],
        required: true,
        proposedAnswer: 'SF',
      },
      { label: 'Writing sample', kind: 'file', required: true },
      {
        label: 'Gender',
        kind: 'choice',
        options: ['Male', 'Female', 'Non-binary', 'Decline to answer'],
        isEeo: true,
      },
    ]);
  if (!nameId || !emailId || !whyId || !projectId || !officeId || !sampleId || !genderId) {
    throw new Error('the questions were not all added');
  }

  // Every load of this resume the page starts, so the first click waits for
  // them all, as in review.spec.ts.
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

  await page.goto(`/applications/${appId}/review`);
  await expect(page.getByTestId('review-step-questions')).toHaveText('2 Questions');
  await expect(page.getByTestId('review-step-approve')).toHaveText('3 Approve');
  await expect(page.getByRole('button', { name: 'Approve resume' })).toBeEnabled();
  await expect.poll(() => loadsInFlight).toBe(0);

  // Approving the resume moves on to the questions.
  await page.getByRole('button', { name: 'Approve resume' }).click();
  await expect(page.getByTestId('review-step-resume')).toHaveText('1 Resume – ok');
  const progress = page.getByTestId('questions-progress');
  await expect(progress).toHaveText('Questions · 0 of 7 approved · 5 required still open');

  // Final approval waits for the required questions, and says where they are.
  await page.getByTestId('review-step-approve').click();
  await expect(page.getByTestId('approve-problems')).toContainText(
    'Approve the 5 required questions still open in step 2.',
  );
  await expect(page.getByRole('button', { name: 'Approve + copy command' })).toBeDisabled();
  await page.getByTestId('review-step-questions').click();

  // The EEO question has nothing picked, and cannot be approved until it does.
  const gender = page.getByTestId(`question-card-${genderId}`);
  await expect(gender).toContainText('the agent never answers these');
  await expect(gender.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(gender.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  let saved = answerSaved(page, genderId);
  await gender.getByRole('radio', { name: 'Decline to answer' }).check();
  expect((await saved).ok()).toBe(true);
  await gender.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(gender).toContainText('✓ Approved');

  // Profile answers: a cleared one stops "Approve all", and says which.
  const profile = page.getByTestId('profile-answers');
  await expect(profile).toContainText('2 from profile (Full name, Email)');
  await profile.getByRole('button', { name: /from profile/ }).click();
  saved = answerSaved(page, emailId);
  await profile.getByRole('textbox', { name: 'Email' }).fill('');
  expect((await saved).ok()).toBe(true);
  await expect(profile.getByRole('button', { name: 'Approve all 2' })).toBeEnabled();
  await profile.getByRole('button', { name: 'Approve all 2' }).click();
  await expect(profile).toContainText('Email: answer it first.');

  saved = answerSaved(page, emailId);
  await profile.getByRole('textbox', { name: 'Email' }).fill('chris@example.test');
  expect((await saved).ok()).toBe(true);
  await expect(profile.getByRole('button', { name: 'Approve all 2' })).toBeEnabled();
  await profile.getByRole('button', { name: 'Approve all 2' }).click();
  await expect(profile).toContainText('✓ 2 from profile, approved');

  // An open-ended answer: edited, saved, approved.
  const why = page.getByTestId(`question-card-${whyId}`);
  await expect(why).toContainText('agent draft');
  saved = answerSaved(page, whyId);
  await why
    .getByRole('textbox', { name: 'Why Forward Deployed Engineering?' })
    .fill('I like working next to the people who use what I build.');
  expect((await saved).ok()).toBe(true);
  await expect(why).toContainText('12 words');
  await why.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(why).toContainText('✓ Approved');

  // Another is sent back for a redraft, which the agent reads from the API.
  const project = page.getByTestId(`question-card-${projectId}`);
  await project.getByRole('button', { name: 'Redraft' }).click();
  await project
    .getByRole('textbox', { name: 'What should change?' })
    .fill('Mention the Acme on-call work');
  await project.getByRole('button', { name: 'Send to agent' }).click();
  await expect(project).toContainText('Mention the Acme on-call work');
  await expect(project).toContainText('waiting for the agent');
  await expect(project.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  const asked = await getApplicationDetail(page, appId);
  expect(asked.questions.find((q) => q.id === projectId)?.redraftNote).toBe(
    'Mention the Acme on-call work',
  );

  // A choice given as an instruction.
  const office = page.getByTestId(`question-card-${officeId}`);
  await expect(office.getByRole('radio', { name: 'SF' })).toBeChecked();
  await office.getByRole('radio', { name: 'Give an instruction' }).check();
  saved = answerSaved(page, officeId);
  await office
    .getByRole('textbox', { name: 'Which office?: instruction' })
    .fill('Boston if listed, otherwise Remote');
  await saved;
  await expect(office.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await office.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(office).toContainText('✓ Approved');

  // A file question, answered by uploading one here.
  const sample = page.getByTestId(`question-card-${sampleId}`);
  await expect(sample).toContainText('Pick an attachment.');
  await expect(sample.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  saved = answerSaved(page, sampleId);
  await sample.locator('input[type="file"]').setInputFiles({
    name: 'take-home.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 a take-home'),
  });
  expect((await saved).ok()).toBe(true);
  await expect(
    sample.getByRole('combobox', { name: 'Writing sample' }).locator('option:checked'),
  ).toHaveText('take-home.pdf');
  await expect(sample.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await sample.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(sample).toContainText('✓ Approved');

  // Every required question is approved; the optional one waiting on a
  // redraft is left blank, and does not hold approval up.
  await expect(progress).toHaveText('Questions · 6 of 7 approved');
  await expect(page.getByTestId('review-step-questions')).toHaveText('2 Questions');
  await page.getByRole('button', { name: 'Next: Approve →' }).click();
  await expect(page.getByTestId('approve-row-questions')).toContainText('6 of 7 approved');
  await expect(page.getByTestId('approve-optional-note')).toHaveText(
    '1 optional question will be left blank.',
  );
  await expect(page.getByRole('button', { name: 'Approve + copy command' })).toBeEnabled();

  // Back to approve that one too, after cancelling the request.
  await page.getByTestId('review-step-questions').click();
  await project.getByRole('button', { name: 'Cancel request' }).click();
  await expect(project.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await project.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(project).toContainText('✓ Approved');
  await expect(page.getByTestId('review-step-questions')).toHaveText('2 Questions – ok');

  await page.getByTestId('review-step-approve').click();
  await expect(page.getByTestId('approve-row-questions')).toContainText('7 of 7 approved ✓');
  await page.getByRole('button', { name: 'Approve + copy command' }).click();
  await expect(page.getByTestId('review-status')).toHaveText('Ready', { timeout: 60_000 });

  const ready = await getApplicationDetail(page, appId);
  expect(ready.status).toBe('ready');
  const officeAnswer = ready.questions.find((q) => q.id === officeId);
  expect([officeAnswer?.answerMode, officeAnswer?.answer]).toEqual([
    'instruction',
    'Boston if listed, otherwise Remote',
  ]);
  expect(ready.questions.every((q) => q.approvedAt !== null)).toBe(true);

  // An edit after approval reopens the question and the application.
  await page.getByTestId('review-step-questions').click();
  saved = answerSaved(page, whyId);
  await why
    .getByRole('textbox', { name: 'Why Forward Deployed Engineering?' })
    .fill('Changed after approving it.');
  expect((await saved).ok()).toBe(true);
  await expect(why).toContainText('You changed this after approving it.');
  await expect(page.getByTestId('review-step-questions')).toHaveText('2 Questions');
  await expect(page.getByTestId('review-status')).toHaveText('Needs review');

  const reopened = await getApplicationDetail(page, appId);
  expect(reopened.status).toBe('needs_review');
  expect(reopened.approvedAt).toBeNull();
  expect(reopened.questions.find((q) => q.id === whyId)?.approvedAt).toBeNull();
  expect(reopened.questions.find((q) => q.id === officeId)?.approvedAt).not.toBeNull();
  expect(reopened.resumeApprovedAt).not.toBeNull();
});

test('while the agent is still proposing, no answer can be approved', async ({ page }) => {
  await login(page);
  const appId = await createApplicationViaApi(page, {
    company: `T-Questions Proposing ${Date.now()}`,
    createResumeFrom: await getDefaultResumeId(page),
  });
  await setApplicationPipelineState(appId, { status: 'proposing' });
  const [nameId] = await insertApplicationQuestions(appId, [
    { label: 'Why us?', kind: 'text', required: true, proposedAnswer: 'Because.' },
  ]);

  await page.goto(`/applications/${appId}/review`);
  await page.getByTestId('review-step-questions').click();
  await expect(page.getByText('The agent is still working on this one.')).toBeVisible();
  const card = page.getByTestId(`question-card-${nameId}`);
  await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
});
