/**
 * Orchestrates one feedback submission: upload the screenshot (if any),
 * format the issue, open it. Sits between the route handler and the GitHub
 * client so the handler stays as thin as every other one under `app/api/**`.
 */

import { createIssue, readGitHubConfig, uploadScreenshot, type CreatedIssue } from './github.ts';
import {
  extensionForMimeType,
  issueBody,
  issueLabels,
  issueTitle,
  screenshotPath,
  type FeedbackKind,
} from './issue.ts';

export interface ScreenshotUpload {
  bytes: Uint8Array;
  mimeType: string;
}

export interface FeedbackSubmission {
  kind: FeedbackKind;
  description: string;
  url: string;
  viewport?: string | null;
  userAgent?: string | null;
  screenshot?: ScreenshotUpload | null;
}

export interface FeedbackResult extends CreatedIssue {
  /** False when a screenshot was attached but couldn't be pushed to GitHub. */
  screenshotUploaded: boolean;
}

export async function fileFeedback(submission: FeedbackSubmission): Promise<FeedbackResult> {
  const config = readGitHubConfig();
  const submittedAt = new Date();

  let screenshotUrl: string | null = null;
  let screenshotError: string | null = null;

  if (submission.screenshot) {
    const extension = extensionForMimeType(submission.screenshot.mimeType) ?? 'png';
    const path = screenshotPath(extension, submittedAt, crypto.randomUUID());
    try {
      screenshotUrl = await uploadScreenshot(
        config,
        submission.screenshot.bytes,
        path,
        `feedback: screenshot for ${path}`,
      );
    } catch (err) {
      // The description is the part worth keeping. File the issue anyway and
      // say what happened, rather than making the user retype everything.
      screenshotError = err instanceof Error ? err.message : String(err);
      console.error('[feedback] screenshot upload failed:', screenshotError);
    }
  }

  const issue = await createIssue(config, {
    title: issueTitle(submission.kind, submission.description),
    body: issueBody({
      kind: submission.kind,
      description: submission.description,
      url: submission.url,
      viewport: submission.viewport,
      userAgent: submission.userAgent,
      screenshotUrl,
      screenshotError,
      submittedAt,
    }),
    labels: issueLabels(submission.kind),
  });

  return { ...issue, screenshotUploaded: screenshotError === null };
}
