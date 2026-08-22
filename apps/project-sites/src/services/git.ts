/**
 * @module services/git
 * @description R2-backed git-style snapshot system for site files: commit history,
 * diffing, and revert without a real git implementation.
 *
 * ## R2 Layout
 *
 * ```
 * sites/{slug}/git/HEAD              → current commit ID (plain text)
 * sites/{slug}/git/commits/{id}.json → commit metadata (parent, message, author, file list)
 * sites/{slug}/git/trees/{id}/       → file contents for that commit
 * ```
 *
 * ## Design Decisions
 *
 * - **JSON over isomorphic-git**: isomorphic-git requires Node.js `fs` semantics
 *   that don't map cleanly to R2's object store API in Cloudflare Workers.
 * - **Full snapshots, not diffs**: Each commit stores a complete copy of all files —
 *   trades storage for simplicity and fast checkout (no diff-chain reconstruction).
 * - **Coexists with existing R2 versioned paths**: git data lives alongside
 *   `sites/{slug}/{version}/`; a commit may reference the R2 version path it corresponds to.
 *
 * @remarks Cloudflare Workers runtime — all operations async, using the R2 bucket binding.
 *
 * @packageDocumentation
 */

/**
 * Metadata stored for each commit/snapshot.
 *
 * @remarks Stored as JSON at `sites/{slug}/git/commits/{id}.json` in R2.
 */
export interface CommitMetadata {
  id: string;
  message: string;
  timestamp: string;
  author: string;
  /** ID of the parent commit, or `null` for the initial commit. */
  parentId: string | null;
  /** Optional reference to the R2 build version path this commit corresponds to. */
  buildVersion?: string;
  files: Array<{ name: string; size: number }>;
}

/**
 * Summary of a commit for list/history views.
 *
 * @remarks Returned by {@link getHistory} — display metadata only, no file contents.
 */
export interface CommitSummary {
  /** Commit ID (maps to {@link CommitMetadata.id}). */
  sha: string;
  message: string;
  date: string;
  author: string;
  fileCount: number;
  buildVersion?: string;
}

/**
 * A file with its name and text content.
 *
 * @remarks Used for both input (committing) and output (checking out a snapshot).
 */
export interface GitFile {
  name: string;
  content: string;
}

/**
 * Result of comparing two snapshots.
 *
 * @remarks Returned by {@link diffSnapshots}.
 */
export interface DiffResult {
  /** Files present in the target but not in the base commit. */
  added: string[];
  /** Files present in the base but not in the target commit. */
  removed: string[];
  /** Files present in both but with different content. */
  modified: string[];
  /** Files present in both with identical content. */
  unchanged: string[];
}

/**
 * Build the R2 key prefix for a site's git data.
 *
 * @returns The R2 prefix string (e.g., `sites/my-site/git/`).
 */
function gitPrefix(slug: string): string {
  return `sites/${slug}/git/`;
}

/**
 * Create a new snapshot (commit) of site files in R2.
 *
 * Stores file contents under `sites/{slug}/git/trees/{id}/` and commit metadata at
 * `sites/{slug}/git/commits/{id}.json`. Updates HEAD to the new commit.
 *
 * @param author - Author name (defaults to `'ProjectSites AI'`).
 * @param buildVersion - Optional R2 build version this commit corresponds to.
 * @returns The commit ID (UUID).
 * @throws {Error} If R2 operations fail.
 *
 * @see {@link getHistory} to list commits
 * @see {@link checkoutSnapshot} to restore files from a commit
 */
export async function createSnapshot(
  bucket: R2Bucket,
  slug: string,
  files: GitFile[],
  message: string,
  author: string = 'ProjectSites AI',
  buildVersion?: string,
): Promise<string> {
  const prefix = gitPrefix(slug);
  const id = crypto.randomUUID();

  // Current HEAD becomes this commit's parent.
  let parentId: string | null = null;
  try {
    const headObj = await bucket.get(`${prefix}HEAD`);
    if (headObj) {
      parentId = (await headObj.text()).trim() || null;
    }
  } catch {
    // No HEAD yet — this is the first commit.
  }

  const commit: CommitMetadata = {
    id,
    message,
    timestamp: new Date().toISOString(),
    author,
    parentId,
    buildVersion,
    files: files.map((f) => ({ name: f.name, size: f.content.length })),
  };

  const uploads: Promise<R2Object>[] = [];
  for (const f of files) {
    uploads.push(
      bucket.put(`${prefix}trees/${id}/${f.name}`, f.content, {
        httpMetadata: { contentType: guessContentType(f.name) },
      }),
    );
  }
  await Promise.all(uploads);

  await bucket.put(`${prefix}commits/${id}.json`, JSON.stringify(commit, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  await bucket.put(`${prefix}HEAD`, id);

  return id;
}

/**
 * Get commit history for a site, walking the parent chain from HEAD.
 *
 * @param depth - Maximum number of commits to return (defaults to 20).
 * @returns Array of commit summaries, newest first.
 *
 * @remarks If a commit's metadata can't be read (corrupted/deleted), the chain stops.
 *
 * @see {@link createSnapshot} to add commits
 * @see {@link checkoutSnapshot} to restore a specific commit
 */
export async function getHistory(
  bucket: R2Bucket,
  slug: string,
  depth: number = 20,
): Promise<CommitSummary[]> {
  const prefix = gitPrefix(slug);
  const history: CommitSummary[] = [];

  let currentId: string | null = null;
  try {
    const headObj = await bucket.get(`${prefix}HEAD`);
    if (headObj) {
      currentId = (await headObj.text()).trim() || null;
    }
  } catch {
    return [];
  }

  if (!currentId) return [];

  let remaining = depth;
  while (currentId && remaining > 0) {
    try {
      const commitObj = await bucket.get(`${prefix}commits/${currentId}.json`);
      if (!commitObj) break;

      const commit: CommitMetadata = await commitObj.json();
      history.push({
        sha: commit.id,
        message: commit.message,
        date: commit.timestamp,
        author: commit.author,
        fileCount: commit.files.length,
        buildVersion: commit.buildVersion,
      });

      currentId = commit.parentId;
      remaining--;
    } catch {
      break;
    }
  }

  return history;
}

/**
 * Retrieve the metadata for a specific commit.
 *
 * @returns The commit metadata, or `null` if not found.
 *
 * @see {@link getHistory} for listing multiple commits
 */
export async function getCommit(
  bucket: R2Bucket,
  slug: string,
  commitId: string,
): Promise<CommitMetadata | null> {
  const prefix = gitPrefix(slug);
  try {
    const obj = await bucket.get(`${prefix}commits/${commitId}.json`);
    if (!obj) return null;
    return await obj.json();
  } catch {
    return null;
  }
}

/**
 * Checkout (restore) all files from a specific commit.
 *
 * Does NOT modify HEAD — use {@link revertToSnapshot} to also update HEAD and
 * create a revert commit.
 *
 * @returns Array of files with their contents.
 * @throws {Error} If the commit does not exist.
 *
 * @see {@link revertToSnapshot} to checkout AND create a revert commit
 */
export async function checkoutSnapshot(
  bucket: R2Bucket,
  slug: string,
  commitId: string,
): Promise<GitFile[]> {
  const prefix = gitPrefix(slug);

  const commit = await getCommit(bucket, slug, commitId);
  if (!commit) {
    throw new Error(`Commit not found: ${commitId}`);
  }

  const filePromises = commit.files.map(async (f) => {
    try {
      const obj = await bucket.get(`${prefix}trees/${commitId}/${f.name}`);
      if (!obj) return null;
      const content = await obj.text();
      return { name: f.name, content };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(filePromises);
  return results.filter((f): f is GitFile => f !== null);
}

/**
 * Revert a site to a previous snapshot by checking out its files and creating a
 * new commit that records the revert — the primary "undo" operation.
 *
 * @param author - Author name for the revert commit.
 * @returns Object with the new commit ID and the restored files.
 * @throws {Error} If the target commit does not exist or has no files.
 *
 * @see {@link checkoutSnapshot} to read files without creating a new commit
 * @see {@link getHistory} to find the commit ID to revert to
 */
export async function revertToSnapshot(
  bucket: R2Bucket,
  slug: string,
  commitId: string,
  author: string = 'ProjectSites AI',
): Promise<{ commitId: string; files: GitFile[] }> {
  const files = await checkoutSnapshot(bucket, slug, commitId);

  if (files.length === 0) {
    throw new Error(`No files found in commit: ${commitId}`);
  }

  const originalCommit = await getCommit(bucket, slug, commitId);
  const originalMessage = originalCommit?.message ?? 'unknown';

  const newCommitId = await createSnapshot(
    bucket,
    slug,
    files,
    `Revert to: ${originalMessage} (${commitId.substring(0, 8)})`,
    author,
    originalCommit?.buildVersion,
  );

  return { commitId: newCommitId, files };
}

/**
 * Compare two snapshots and return a diff summary of added/removed/modified/unchanged files.
 *
 * @param baseCommitId - The base (older) commit ID.
 * @param targetCommitId - The target (newer) commit ID.
 * @returns A {@link DiffResult} summarizing the differences.
 * @throws {Error} If either commit does not exist.
 *
 * @see {@link getHistory} to find commit IDs
 */
export async function diffSnapshots(
  bucket: R2Bucket,
  slug: string,
  baseCommitId: string,
  targetCommitId: string,
): Promise<DiffResult> {
  const [baseFiles, targetFiles] = await Promise.all([
    checkoutSnapshot(bucket, slug, baseCommitId),
    checkoutSnapshot(bucket, slug, targetCommitId),
  ]);

  const baseMap = new Map(baseFiles.map((f) => [f.name, f.content]));
  const targetMap = new Map(targetFiles.map((f) => [f.name, f.content]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];

  for (const [name, content] of targetMap) {
    const baseContent = baseMap.get(name);
    if (baseContent === undefined) {
      added.push(name);
    } else if (baseContent !== content) {
      modified.push(name);
    } else {
      unchanged.push(name);
    }
  }

  for (const name of baseMap.keys()) {
    if (!targetMap.has(name)) {
      removed.push(name);
    }
  }

  return { added, removed, modified, unchanged };
}

/**
 * Get the current HEAD commit ID for a site.
 *
 * @returns The current HEAD commit ID, or `null` if no commits exist.
 */
export async function getHead(bucket: R2Bucket, slug: string): Promise<string | null> {
  try {
    const obj = await bucket.get(`${gitPrefix(slug)}HEAD`);
    if (!obj) return null;
    const text = (await obj.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Guess MIME content type from a file extension.
 *
 * @returns The guessed MIME type, defaulting to `application/octet-stream`.
 */
function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    txt: 'text/plain',
    xml: 'text/xml',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ts: 'application/typescript',
    tsx: 'application/typescript',
    jsx: 'application/javascript',
    md: 'text/markdown',
    yaml: 'text/yaml',
    yml: 'text/yaml',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
