import { expect, test, type Page, type Request } from '@playwright/test';
import {
  createApplicationViaApi,
  getApplicationDetail,
  getDefaultResumeId,
  getSavedAnswerRow,
  insertApplicationQuestions,
  insertSavedAnswer,
  login,
  setApplicationPipelineState,
} from './support';

/**
 * Saved answers in the review's Questions step (D-048): ticking "remember
 * this answer" saves it, an edit while ticked changes the saved one too, an
 * EEO answer can be remembered once Chris picks it, and unticking retires
 * it. A question the agent linked to a saved answer arrives as one approved
 * green line, and editing it reopens it like any other answer.
 *
 * Questions and the linked saved answer are written straight to the
 * database: only the agent records questions, over MCP. Every saved answer
 * made here is unticked again, so the agent never sees it.
 */

/** The PATCH an answer edit sends, once its debounce has run. */
function answerSaved(page: Page, questionId: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/application-questions/${questionId}`),
  );
}

/** The PUT a tick or an untick sends. */
function rememberSaved(page: Page, questionId: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith(`/api/application-questions/${questionId}/remember`),
  );
}

/** A Needs review application with no letter, so its steps are Resume,
 *  Questions, Approve. */
async function reviewApplication(page: Page, company: string) {
  const appId = await createApplicationViaApi(page, {
    company: `${company} ${Date.now()}`,
    createResumeFrom: await getDefaultResumeId(page),
  });
  const { resumeId } = await getApplicationDetail(page, appId);
  await setApplicationPipelineState(appId, { status: 'needs_review' });
  return { appId, resumeId };
}

/** Opens the review on the Questions step, once every load of the resume
 *  the page starts has finished, as in questions.spec.ts. */
async function openQuestions(page: Page, appId: string, resumeId: string | null) {
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
  await expect(page.getByRole('button', { name: 'Approve resume' })).toBeEnabled();
  await expect.poll(() => loadsInFlight).toBe(0);
  await page.getByTestId('review-step-questions').click();
  await expect(page.getByTestId('questions-progress')).toBeVisible();
}

/** What the API says the question is remembered as. */
async function savedAnswerIdOf(page: Page, appId: string, questionId: string) {
  const detail = await getApplicationDetail(page, appId);
  return detail.questions.find((q) => q.id === questionId)?.savedAnswerId ?? null;
}

test('remember an answer, and an edit while ticked changes the saved one', async ({ page }) => {
  await login(page);
  const { appId, resumeId } = await reviewApplication(page, 'T-Saved Remember');
  const [whyId, sampleId, genderId] = await insertApplicationQuestions(appId, [
    {
      label: 'Why us?',
      kind: 'text',
      required: true,
      proposedAnswer: 'You build tools next to the people who use them.',
    },
    { label: 'Writing sample', kind: 'file' },
    {
      label: 'Gender',
      kind: 'choice',
      options: ['Male', 'Female', 'Decline to answer'],
      isEeo: true,
    },
  ]);
  if (!whyId || !sampleId || !genderId) throw new Error('the questions were not all added');
  await openQuestions(page, appId, resumeId);

  // Ticking saves it, and says what ticking means.
  const why = page.getByTestId(`question-card-${whyId}`);
  const whyBox = why.getByRole('checkbox', { name: 'remember this answer' });
  await expect(whyBox).not.toBeChecked();
  let put = rememberSaved(page, whyId);
  await whyBox.check();
  expect((await put).ok()).toBe(true);
  await expect(why).toContainText(
    'Saved for future applications. Editing this answer changes the saved one too.',
  );
  await expect.poll(() => savedAnswerIdOf(page, appId, whyId)).toEqual(expect.any(String));
  const whySaved = (await savedAnswerIdOf(page, appId, whyId))!;

  // An edit while it is ticked is the saved answer's edit too.
  const patched = answerSaved(page, whyId);
  await why.getByRole('textbox', { name: 'Why us?' }).fill('I use what you build every day.');
  expect((await patched).ok()).toBe(true);
  await expect
    .poll(async () => (await getSavedAnswerRow(whySaved)).answer)
    .toBe('I use what you build every day.');

  // An attachment belongs to one application, so it is never remembered.
  await expect(
    page
      .getByTestId(`question-card-${sampleId}`)
      .getByRole('checkbox', { name: 'remember this answer' }),
  ).toHaveCount(0);

  // An EEO answer is Chris's own, so it can be remembered once he picks it.
  const gender = page.getByTestId(`question-card-${genderId}`);
  const genderBox = gender.getByRole('checkbox', { name: 'remember this answer' });
  await expect(genderBox).toBeDisabled();
  const picked = answerSaved(page, genderId);
  await gender.getByRole('radio', { name: 'Decline to answer' }).check();
  expect((await picked).ok()).toBe(true);
  await expect(genderBox).toBeEnabled();
  put = rememberSaved(page, genderId);
  await genderBox.check();
  expect((await put).ok()).toBe(true);
  await expect.poll(() => savedAnswerIdOf(page, appId, genderId)).toEqual(expect.any(String));
  const genderSaved = (await savedAnswerIdOf(page, appId, genderId))!;
  expect((await getSavedAnswerRow(genderSaved)).answer).toBe('Decline to answer');

  // Unticking retires each one: archived, never deleted, and unlinked.
  for (const [questionId, box, savedId] of [
    [whyId, whyBox, whySaved],
    [genderId, genderBox, genderSaved],
  ] as const) {
    put = rememberSaved(page, questionId);
    await box.uncheck();
    expect((await put).ok()).toBe(true);
    expect((await getSavedAnswerRow(savedId)).isArchived).toBe(true);
    await expect.poll(() => savedAnswerIdOf(page, appId, questionId)).toBeNull();
  }
});

test('a saved answer arrives approved, and an edit reopens it', async ({ page }) => {
  await login(page);
  const { appId, resumeId } = await reviewApplication(page, 'T-Saved Linked');
  const savedId = await insertSavedAnswer(appId, {
    prompt: 'Veteran status',
    kind: 'choice',
    answer: 'No',
  });
  const [veteranId] = await insertApplicationQuestions(appId, [
    {
      label: 'Veteran status',
      kind: 'choice',
      options: ['Yes', 'No', 'Decline to answer'],
      required: true,
      isEeo: true,
      source: 'saved',
      proposedAnswer: 'No',
      savedAnswerId: savedId,
      approvedAt: new Date(),
    },
    { label: 'Why us?', kind: 'text', proposedAnswer: 'Because.' },
  ]);
  if (!veteranId) throw new Error('the questions were not added');
  await openQuestions(page, appId, resumeId);

  // One green line, still on the page, its saved answer still remembered.
  const row = page.getByTestId(`saved-answer-row-${veteranId}`);
  await expect(row).toContainText('Veteran status: No');
  await expect(row).toContainText('saved answer, already approved');
  await expect(row.getByRole('checkbox', { name: 'remember this answer' })).toBeChecked();
  await expect(page.getByTestId('questions-progress')).toHaveText('Questions · 1 of 2 approved');

  await page.getByTestId('review-step-approve').click();
  await expect(page.getByTestId('approve-row-questions')).toContainText(
    '1 of 2 approved (1 from saved answers)',
  );
  await page.getByTestId('review-step-questions').click();

  // Edit opens the full card; a change unapproves it like any other edit.
  await row.getByRole('button', { name: 'Edit' }).click();
  const card = page.getByTestId(`question-card-${veteranId}`);
  await expect(card).toContainText('saved answer');
  await expect(card).toContainText('✓ Approved');
  const patched = answerSaved(page, veteranId);
  await card.getByRole('radio', { name: 'Decline to answer' }).check();
  expect((await patched).ok()).toBe(true);
  await expect(card).toContainText('You changed this after approving it.');
  await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  const reopened = await getApplicationDetail(page, appId);
  expect(reopened.questions.find((q) => q.id === veteranId)?.approvedAt).toBeNull();
  // Still remembered, so the edit changed the saved answer as well.
  expect((await getSavedAnswerRow(savedId)).answer).toBe('Decline to answer');

  // Unticking retires the saved answer for later forms; this one keeps its answer.
  const put = rememberSaved(page, veteranId);
  await card.getByRole('checkbox', { name: 'remember this answer' }).uncheck();
  expect((await put).ok()).toBe(true);
  expect((await getSavedAnswerRow(savedId)).isArchived).toBe(true);
  const after = await getApplicationDetail(page, appId);
  expect(after.questions.find((q) => q.id === veteranId)?.answer).toBe('Decline to answer');
});
