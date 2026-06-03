/**
 * Additive unit tests for {@link services/changeset_service} (convergence r9).
 *
 * The sibling `conversational_editing.test.ts` already covers the happy-path
 * shapes of `createChangeset` / `revertChangeset` / `getHistory` /
 * `getChangesetDiff` / `getHeadChangesetId` / `sha256Hex`. This file is STRICTLY
 * ADDITIVE — it targets the branches that sibling does NOT exercise:
 *
 *  - `persistFiles` standalone: exact R2 key + serialized JSON body
 *  - `createChangeset` with NO resolvable slug → R2 put skipped, bundle key null
 *  - explicit `operationKinds` overriding the inferred default (incl. `delete`)
 *  - `chatId` omitted → `chat_id: null` default
 *  - `previousFileHashes` skipping prior rows whose `after_hash` is null
 *  - org/site ownership scoping in the revert lookup SQL
 *  - revert carrying the original's `r2_bundle_key` + auto-prompt + null reason
 *  - `getChangesetDiff` null `op_kind` → `opKind: null` (not coerced)
 *  - `getChangesetDiff` file ordering (ORDER BY file_path ASC) + empty file set
 *  - `toSummary` status fallback when the stored status is garbage
 *  - `getHeadChangesetId` non-deleted + ordering SQL contract
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import {
  createChangeset,
  revertChangeset,
  getHistory,
  getChangesetDiff,
  getHeadChangesetId,
  persistFiles,
} from '../services/changeset_service.js';

const mockQuery = dbQuery as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockInsert = dbInsert as unknown as jest.Mock;
const mockUpdate = dbUpdate as unknown as jest.Mock;

function makeEnv() {
  const put = jest.fn().mockResolvedValue({});
  return {
    DB: {} as unknown,
    SITES_BUCKET: { put } as unknown,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
});

// ---------------------------------------------------------------------------
// persistFiles (standalone — not directly tested by the sibling spec)
// ---------------------------------------------------------------------------
describe('persistFiles', () => {
  it('writes the bundle to the changeset-namespaced R2 key with the file payload', async () => {
    const env = makeEnv();
    const files = [
      { path: 'index.html', content: '<h1>X</h1>' },
      { path: 'a/b.css', content: 'body{}' },
    ];

    const key = await persistFiles(env, 'my-slug', 'cs_abc', files);

    expect(key).toBe('sites/my-slug/changesets/cs_abc/files.json');
    const putCall = (env.SITES_BUCKET.put as jest.Mock).mock.calls[0];
    expect(putCall[0]).toBe('sites/my-slug/changesets/cs_abc/files.json');
    // Body is JSON carrying the changeset id + every file path/content.
    const body = JSON.parse(putCall[1] as string);
    expect(body).toEqual({ changesetId: 'cs_abc', files });
    expect(putCall[2]).toEqual(
      expect.objectContaining({ httpMetadata: { contentType: 'application/json' } }),
    );
  });

  it('serializes an empty file set without error', async () => {
    const env = makeEnv();
    const key = await persistFiles(env, 's', 'cs_empty', []);
    expect(key).toBe('sites/s/changesets/cs_empty/files.json');
    const body = JSON.parse((env.SITES_BUCKET.put as jest.Mock).mock.calls[0][1] as string);
    expect(body.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createChangeset — uncovered branches
// ---------------------------------------------------------------------------
describe('createChangeset (additive branches)', () => {
  it('skips the R2 put and stores a null bundle key when the slug cannot be resolved', async () => {
    const env = makeEnv();
    // getHeadChangesetId → null head; resolveSlug → null (deleted/unknown site)
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const id = await createChangeset(env, {
      siteId: 'orphan_site',
      userId: 'u',
      prompt: 'p',
      files: [{ path: 'a.txt', content: 'x' }],
    });

    expect(typeof id).toBe('string');
    // No slug → bundle never persisted to R2.
    expect((env.SITES_BUCKET.put as jest.Mock)).not.toHaveBeenCalled();
    // Changeset row records a null r2_bundle_key.
    expect(mockInsert.mock.calls[0][2]).toEqual(
      expect.objectContaining({ r2_bundle_key: null }),
    );
  });

  it('honors an explicit operationKinds override (delete) instead of the inferred default', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ slug: 's' });

    await createChangeset(env, {
      siteId: 'site_1',
      userId: 'u',
      prompt: 'remove file',
      files: [{ path: 'old.html', content: '' }],
      operationKinds: { 'old.html': 'delete' },
    });

    // file row (2nd insert) carries the explicit op kind, not the inferred 'insert'.
    expect(mockInsert.mock.calls[1][1]).toBe('changeset_files');
    expect(mockInsert.mock.calls[1][2]).toEqual(
      expect.objectContaining({ file_path: 'old.html', op_kind: 'delete' }),
    );
  });

  it('coerces an unknown operationKinds value back to "replace"', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ slug: 's' });

    await createChangeset(env, {
      siteId: 'site_1',
      userId: 'u',
      prompt: 'p',
      files: [{ path: 'f.txt', content: 'c' }],
      operationKinds: { 'f.txt': 'frobnicate' as never },
    });

    expect(mockInsert.mock.calls[1][2]).toEqual(
      expect.objectContaining({ op_kind: 'replace' }),
    );
  });

  it('defaults chat_id to null when chatId is omitted', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ slug: 's' });

    await createChangeset(env, {
      siteId: 'site_1',
      userId: 'u',
      prompt: 'p',
      files: [{ path: 'a.txt', content: 'x' }],
    });

    expect(mockInsert.mock.calls[0][2]).toEqual(
      expect.objectContaining({ chat_id: null }),
    );
  });

  it('ignores prior file rows whose after_hash is null when computing before-hashes', async () => {
    const env = makeEnv();
    mockQueryOne
      .mockResolvedValueOnce({ id: 'cs_parent' }) // getHeadChangesetId
      .mockResolvedValueOnce({ slug: 's' }); // resolveSlug
    // prior bundle: one row WITH an after_hash, one row WITHOUT (null) → only the
    // first should become a before-hash in the new changeset's file rows.
    mockQuery.mockResolvedValueOnce({
      data: [
        { file_path: 'has.html', before_hash: null, after_hash: 'prior_hash', op_kind: 'replace' },
        { file_path: 'null.html', before_hash: null, after_hash: null, op_kind: 'insert' },
      ],
      error: null,
    });

    await createChangeset(env, {
      siteId: 'site_1',
      userId: 'u',
      prompt: 'p',
      files: [
        { path: 'has.html', content: 'NEW1' },
        { path: 'null.html', content: 'NEW2' },
      ],
    });

    // file row for 'has.html' (2nd insert) gets the prior after_hash as before_hash + 'replace'.
    expect(mockInsert.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        file_path: 'has.html',
        before_hash: 'prior_hash',
        op_kind: 'replace',
      }),
    );
    // file row for 'null.html' (3rd insert) has no before_hash (prior after_hash was null) → 'insert'.
    expect(mockInsert.mock.calls[2][2]).toEqual(
      expect.objectContaining({
        file_path: 'null.html',
        before_hash: null,
        op_kind: 'insert',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getHeadChangesetId — SQL contract / scoping
// ---------------------------------------------------------------------------
describe('getHeadChangesetId (SQL contract)', () => {
  it('scopes by site_id, filters soft-deleted, and orders newest-first', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce({ id: 'cs_head' });

    await getHeadChangesetId(env, 'site_42');

    const [, sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toMatch(/site_id = \?/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/ORDER BY applied_at DESC/);
    expect(params).toEqual(['site_42']);
  });
});

// ---------------------------------------------------------------------------
// revertChangeset — ownership scoping + carried fields
// ---------------------------------------------------------------------------
describe('revertChangeset (additive branches)', () => {
  it('looks up the target scoped by BOTH changeset id AND site id (ownership)', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'cs_orig',
      site_id: 'site_1',
      chat_id: 'chat_x',
      created_by: 'u1',
      prompt: 'orig',
      status: 'applied',
      parent_changeset_id: null,
      r2_bundle_key: 'sites/s/changesets/cs_orig/files.json',
      revert_reason: null,
      applied_at: '2026-05-28T00:00:00.000Z',
      reverted_at: null,
    });

    await revertChangeset(env, { siteId: 'site_1', changesetId: 'cs_orig', userId: 'u2' });

    const [, sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toMatch(/id = \?/);
    expect(sql).toMatch(/site_id = \?/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(params).toEqual(['cs_orig', 'site_1']);
  });

  it('carries the original bundle key + auto-generated prompt and a null reason when none given', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'cs_origlongid1234',
      site_id: 'site_1',
      chat_id: 'chat_x',
      created_by: 'u1',
      prompt: 'orig',
      status: 'applied',
      parent_changeset_id: null,
      r2_bundle_key: 'sites/s/changesets/cs_origlongid1234/files.json',
      revert_reason: null,
      applied_at: '2026-05-28T00:00:00.000Z',
      reverted_at: null,
    });

    await revertChangeset(env, { siteId: 'site_1', changesetId: 'cs_origlongid1234', userId: 'u2' });

    const insertRow = mockInsert.mock.calls[0][2];
    expect(insertRow).toEqual(
      expect.objectContaining({
        status: 'reverted',
        parent_changeset_id: 'cs_origlongid1234',
        r2_bundle_key: 'sites/s/changesets/cs_origlongid1234/files.json',
        chat_id: 'chat_x', // inherited from the original
        revert_reason: null, // no reason supplied
        prompt: expect.stringContaining('Revert of changeset cs_origl'), // first 8 chars
      }),
    );
    // both applied_at and reverted_at stamped on the new revert row
    expect(insertRow.applied_at).toBeTruthy();
    expect(insertRow.reverted_at).toBeTruthy();
  });

  it('throws and does not stamp the original when the revert row fails to insert', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'cs_orig',
      site_id: 'site_1',
      chat_id: null,
      created_by: 'u1',
      prompt: 'orig',
      status: 'applied',
      parent_changeset_id: null,
      r2_bundle_key: null,
      revert_reason: null,
      applied_at: '2026-05-28T00:00:00.000Z',
      reverted_at: null,
    });
    mockInsert.mockResolvedValueOnce({ error: 'D1 down' });

    await expect(
      revertChangeset(env, { siteId: 'site_1', changesetId: 'cs_orig', userId: 'u2' }),
    ).rejects.toThrow('Failed to insert revert changeset');
    // failure path short-circuits before stamping the original via dbUpdate
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getChangesetDiff — null op_kind + ordering + empty files
// ---------------------------------------------------------------------------
describe('getChangesetDiff (additive branches)', () => {
  it('maps a null op_kind to opKind: null (no "replace" coercion) and orders files ASC', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'cs_1',
      site_id: 'site_1',
      chat_id: null,
      created_by: 'u',
      prompt: 'edit',
      status: 'applied',
      parent_changeset_id: null,
      revert_reason: null,
      applied_at: '2026-05-28T00:00:00.000Z',
      reverted_at: null,
    });
    mockQuery.mockResolvedValueOnce({
      data: [{ file_path: 'index.html', before_hash: 'aaa', after_hash: 'bbb', op_kind: null }],
      error: null,
    });

    const diff = await getChangesetDiff(env, 'cs_1');
    expect(diff!.files[0].opKind).toBeNull();
    // file query is ordered by file_path ASC
    const fileSql = mockQuery.mock.calls[0][1] as string;
    expect(fileSql).toMatch(/ORDER BY file_path ASC/);
  });

  it('returns an empty files array for a changeset that touched no files', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'cs_1',
      site_id: 'site_1',
      chat_id: null,
      created_by: 'u',
      prompt: 'noop',
      status: 'applied',
      parent_changeset_id: null,
      revert_reason: null,
      applied_at: '2026-05-28T00:00:00.000Z',
      reverted_at: null,
    });
    mockQuery.mockResolvedValueOnce({ data: [], error: null });

    const diff = await getChangesetDiff(env, 'cs_1');
    expect(diff!.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toSummary status fallback (exercised via getHistory)
// ---------------------------------------------------------------------------
describe('toSummary status fallback', () => {
  it('falls back to "applied" when the stored status is unrecognized', async () => {
    const env = makeEnv();
    mockQuery.mockResolvedValueOnce({
      data: [
        {
          id: 'cs_weird',
          site_id: 'site_1',
          chat_id: null,
          created_by: 'u',
          prompt: 'p',
          status: 'corrupted_value',
          parent_changeset_id: null,
          revert_reason: null,
          applied_at: '2026-05-28T00:00:00.000Z',
          reverted_at: null,
        },
      ],
      error: null,
    });

    const history = await getHistory(env, 'site_1');
    expect(history[0].status).toBe('applied');
  });

  it('passes through a valid "reverted" status unchanged', async () => {
    const env = makeEnv();
    mockQuery.mockResolvedValueOnce({
      data: [
        {
          id: 'cs_r',
          site_id: 'site_1',
          chat_id: null,
          created_by: 'u',
          prompt: 'p',
          status: 'reverted',
          parent_changeset_id: 'cs_p',
          revert_reason: 'oops',
          applied_at: '2026-05-28T01:00:00.000Z',
          reverted_at: '2026-05-28T01:00:00.000Z',
        },
      ],
      error: null,
    });

    const history = await getHistory(env, 'site_1');
    expect(history[0].status).toBe('reverted');
    expect(history[0].revertReason).toBe('oops');
    expect(history[0].revertedAt).toBe('2026-05-28T01:00:00.000Z');
  });
});
