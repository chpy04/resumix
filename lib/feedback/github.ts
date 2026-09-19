/**
 * The only module that talks to GitHub. Two jobs: park a screenshot
 * somewhere GitHub will render it, and open the issue.
 *
 * **Why the screenshot goes on a branch.** GitHub's issue API has no
 * attachment endpoint — the drag-and-drop uploader in the web UI is not a
 * public API. So the bytes are committed to a dedicated orphan branch
 * (`feedback-assets`, no relation to code history) via the Git Data API,
 * and the issue body links the raw URL *at that commit's sha*, which makes
 * the link immutable. The repo is public, so GitHub's image proxy can fetch
 * it and the screenshot renders inline in the issue.
 *
 * The Git Data API is used rather than the simpler Contents API because the
 * latter caps a file at 1 MB — well under a Retina screenshot.
 */

import { Buffer } from 'node:buffer';

const API_ROOT = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_ASSETS_BRANCH = 'feedback-assets';

/** Just the slots this module reads — narrower than `NodeJS.ProcessEnv` so a
 *  test can pass a literal without inventing a `NODE_ENV`. */
export type FeedbackEnv = Record<string, string | undefined>;

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  assetsBranch: string;
}

/** Missing/malformed env. Maps to 503 — the deployment isn't wired up yet. */
export class FeedbackConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedbackConfigError';
  }
}

/** GitHub said no. Maps to 502 — the app is fine, the upstream call isn't. */
export class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

/**
 * Reads `GITHUB_TOKEN` / `GITHUB_REPO` (`owner/repo`) and the optional
 * `FEEDBACK_ASSETS_BRANCH`. Fails closed and loudly: an unset token must
 * never degrade into silently dropping feedback on the floor.
 */
export function readGitHubConfig(env: FeedbackEnv = process.env): GitHubConfig {
  const token = env.GITHUB_TOKEN?.trim();
  const repoSlug = env.GITHUB_REPO?.trim();

  if (!token) {
    throw new FeedbackConfigError('GITHUB_TOKEN is not set — feedback cannot be filed.');
  }
  if (!repoSlug) {
    throw new FeedbackConfigError('GITHUB_REPO is not set — expected "owner/repo".');
  }

  const parts = repoSlug.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new FeedbackConfigError(`GITHUB_REPO must look like "owner/repo", got "${repoSlug}".`);
  }

  return {
    token,
    owner: parts[0],
    repo: parts[1],
    assetsBranch: env.FEEDBACK_ASSETS_BRANCH?.trim() || DEFAULT_ASSETS_BRANCH,
  };
}

interface GitHubRequest {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Statuses to return `null` for instead of throwing (e.g. a 404 probe). */
  allow?: number[];
}

async function gh<T>(cfg: GitHubConfig, path: string, init: GitHubRequest = {}): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'resumix-feedback',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new GitHubApiError(504, `could not reach GitHub: ${reason}`);
  }

  if (init.allow?.includes(response.status)) return null;

  if (!response.ok) {
    throw new GitHubApiError(response.status, await describeFailure(response, path));
  }

  return (await response.json()) as T;
}

async function describeFailure(response: Response, path: string): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: string; errors?: { message?: string }[] };
    const extra = body.errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join('; ');
    detail = [body.message, extra].filter(Boolean).join(' — ');
  } catch {
    // Non-JSON error body (rare); the status alone will have to do.
  }
  return `GitHub ${response.status} on ${path}${detail ? `: ${detail}` : ''}`;
}

// ---------------------------------------------------------------------------
// Screenshot upload
// ---------------------------------------------------------------------------

interface RefResponse {
  object: { sha: string };
}

/**
 * Commits `bytes` to `path` on the assets branch, creating that branch as an
 * orphan (no parents) on the first ever upload. Returns the immutable raw
 * URL for the file at the commit it just made.
 */
export async function uploadScreenshot(
  cfg: GitHubConfig,
  bytes: Uint8Array,
  path: string,
  message: string,
): Promise<string> {
  const repoPath = `/repos/${cfg.owner}/${cfg.repo}`;

  const blob = await gh<{ sha: string }>(cfg, `${repoPath}/git/blobs`, {
    method: 'POST',
    body: { content: Buffer.from(bytes).toString('base64'), encoding: 'base64' },
  });

  // 404 here means the branch doesn't exist yet — the only expected miss.
  const head = await gh<RefResponse>(cfg, `${repoPath}/git/ref/heads/${cfg.assetsBranch}`, {
    allow: [404],
  });

  let baseTree: string | undefined;
  if (head) {
    const commit = await gh<{ tree: { sha: string } }>(
      cfg,
      `${repoPath}/git/commits/${head.object.sha}`,
    );
    baseTree = commit!.tree.sha;
  }

  const tree = await gh<{ sha: string }>(cfg, `${repoPath}/git/trees`, {
    method: 'POST',
    body: {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: [{ path, mode: '100644', type: 'blob', sha: blob!.sha }],
    },
  });

  const commit = await gh<{ sha: string }>(cfg, `${repoPath}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree!.sha, parents: head ? [head.object.sha] : [] },
  });

  if (head) {
    await gh(cfg, `${repoPath}/git/refs/heads/${cfg.assetsBranch}`, {
      method: 'PATCH',
      body: { sha: commit!.sha },
    });
  } else {
    await gh(cfg, `${repoPath}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${cfg.assetsBranch}`, sha: commit!.sha },
    });
  }

  // Pinned to the commit sha, not the branch name: the issue's screenshot
  // can then never change out from under it.
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${commit!.sha}/${path}`;
}

// ---------------------------------------------------------------------------
// Issue creation
// ---------------------------------------------------------------------------

export interface CreatedIssue {
  number: number;
  url: string;
}

interface IssueResponse {
  number: number;
  html_url: string;
}

/**
 * Opens the issue. Labels are best-effort: a repo that has never had a
 * `feedback` label can 422 the whole request, and losing the report over a
 * missing label would be absurd — so retry once, unlabelled.
 */
export async function createIssue(
  cfg: GitHubConfig,
  issue: { title: string; body: string; labels: string[] },
): Promise<CreatedIssue> {
  const path = `/repos/${cfg.owner}/${cfg.repo}/issues`;

  let created: IssueResponse | null;
  try {
    created = await gh<IssueResponse>(cfg, path, { method: 'POST', body: issue });
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 422) {
      console.warn(`[feedback] issue rejected with labels (${err.message}); retrying without them`);
      created = await gh<IssueResponse>(cfg, path, {
        method: 'POST',
        body: { title: issue.title, body: issue.body },
      });
    } else {
      throw err;
    }
  }

  return { number: created!.number, url: created!.html_url };
}
