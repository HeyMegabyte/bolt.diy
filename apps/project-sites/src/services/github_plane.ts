/**
 * @module services/github_plane
 * @description PL19 GitHub ↔ Plane commit mapper. Pure parsing of Plane issue
 * references from commit messages and GitHub PR references from Plane issue
 * descriptions. Never throws, never makes API calls.
 *
 * @packageDocumentation
 */

/** A GitHub commit that may reference Plane issues. */
export interface CommitRef {
  sha: string;
  message: string;
  repo: string;
}

/** A parsed reference to a Plane issue within a project. */
export interface PlaneRef {
  /** The Plane project key/prefix, e.g. "PROJECT" for "PROJECT-123". */
  projectId: string;
  /** The issue number within the project, e.g. "123". */
  issueId: string;
}

/**
 * Regex matching Plane project-key-prefixed issue references in text.
 * Project key is 2+ characters, starts with an uppercase letter, followed by
 * uppercase letters or digits. Issue number is 1+ digits.
 * Matches PROJECT-123, PL19-42, ABC-1 anywhere in text.
 */
const PLANE_REF_RE = /\b([A-Z][A-Z0-9]*)-(\d+)\b/g;

/**
 * Extract Plane issue references from a commit message.
 *
 * Recognises patterns:
 * - Keyword-linked: "fixes PROJECT-123", "closes PROJECT-123", "refs PROJECT-123"
 * - Bracket-wrapped: "[PROJECT-123] some message"
 * - Bare occurrence anywhere in the message
 *
 * Each unique (projectId, issueId) pair appears once, preserving discovery order.
 * Empty or nullish messages return an empty array (never throws).
 *
 * @param commit - The commit to scan.
 * @returns An ordered, deduplicated array of PlaneRef objects.
 *
 * @example
 * extractPlaneRefs({ sha: 'abc123', message: 'fixes PL19-42\ncloses PL19-43', repo: 'my/repo' });
 * // → [{ projectId: 'PL19', issueId: '42' }, { projectId: 'PL19', issueId: '43' }]
 *
 * @example
 * extractPlaneRefs({ sha: 'def456', message: '[PL19-7] add login page', repo: 'my/repo' });
 * // → [{ projectId: 'PL19', issueId: '7' }]
 */
export function extractPlaneRefs(commit: CommitRef): PlaneRef[] {
  const msg = commit.message ?? '';
  const seen = new Set<string>();
  const refs: PlaneRef[] = [];

  let match: RegExpExecArray | null;
  PLANE_REF_RE.lastIndex = 0;

  while ((match = PLANE_REF_RE.exec(msg)) !== null) {
    const projectId = match[1];
    const issueId = match[2];
    const key = `${projectId}-${issueId}`;

    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ issueId, projectId });
    }
  }

  return refs;
}

/**
 * Build a Plane issue comment body describing a linked commit.
 *
 * The short SHA (first 7 hex characters), repo name, and full commit message
 * are rendered as Markdown suitable for Plane's rich-text issue comments.
 *
 * @param commit - The commit to describe.
 * @returns A Markdown-formatted string.
 *
 * @example
 * buildCommitNote({ sha: 'abc123def456', message: 'fixes PL19-42', repo: 'my/repo' });
 * // → "**Commit:** abc123d\n**Repo:** my/repo\n\nfixes PL19-42"
 */
export function buildCommitNote(commit: CommitRef): string {
  const shortSha = (commit.sha ?? '').slice(0, 7);
  const msg = commit.message ?? '';
  const repo = commit.repo ?? '';

  return `**Commit:** ${shortSha}\n**Repo:** ${repo}\n\n${msg}`;
}

/** Regex matching full GitHub PR URLs. */
const GITHUB_PR_URL_RE = /github\.com\/([^\s/#]+)\/([^\s/#]+)\/pull\/(\d+)/gi;

/** Regex matching short-form owner/repo#PR references. */
const GITHUB_SHORT_RE = /([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)#(\d+)\b/g;

/**
 * Extract GitHub PR references from a Plane issue description body.
 *
 * Recognises:
 * - Full URLs: `https://github.com/owner/repo/pull/123`
 * - Short form: `owner/repo#123`
 *
 * Duplicate (owner, repo, number) tuples are returned once.
 * Empty or nullish bodies return an empty array (never throws).
 *
 * @param body - The Plane issue description text (Markdown or plain).
 * @returns An array of deduplicated GitHub reference objects.
 *
 * @example
 * extractGithubRefs('PR: https://github.com/foo/bar/pull/42\nSee also foo/bar#7');
 * // → [{ owner: 'foo', repo: 'bar', number: 42 }, { owner: 'foo', repo: 'bar', number: 7 }]
 */
export function extractGithubRefs(body: string): {
  owner: string;
  repo: string;
  number: number;
}[] {
  const text = body ?? '';
  const seen = new Set<string>();
  const refs: { owner: string; repo: string; number: number }[] = [];

  let match: RegExpExecArray | null;

  // Full GitHub PR URLs
  GITHUB_PR_URL_RE.lastIndex = 0;
  while ((match = GITHUB_PR_URL_RE.exec(text)) !== null) {
    const owner = match[1];
    const repo = match[2];
    const number = parseInt(match[3], 10);
    const key = `${owner}/${repo}#${number}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ number, owner, repo });
    }
  }

  // Short-form owner/repo#PR
  GITHUB_SHORT_RE.lastIndex = 0;
  while ((match = GITHUB_SHORT_RE.exec(text)) !== null) {
    const owner = match[1];
    const repo = match[2];
    const number = parseInt(match[3], 10);
    const key = `${owner}/${repo}#${number}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ number, owner, repo });
    }
  }

  return refs;
}
