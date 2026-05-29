/**
 * Unit tests for the conversational_editing feature module.
 *
 * Covers:
 *  - createChangeset writes 1 changeset row + N file rows with correct hashes
 *  - revertChangeset creates a new 'reverted' changeset chained to the parent
 *    (original row preserved, only stamped reverted_at — history not deleted)
 *  - extractEditIntent clamps confidence, validates schema, uses fp8-fast alias
 *  - getHistory returns an ordered list
 *  - getChangesetDiff returns per-file before/after hashes
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
  sha256Hex,
} from '../services/changeset_service.js';
import { extractEditIntent } from '../services/edit_intent_extractor.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

function makeEnv(aiResponse?: string) {
  const put = jest.fn().mockResolvedValue({});
  return {
    DB: {} as D1Database,
    SITES_BUCKET: { put } as unknown as R2Bucket,
    AI: {
      run: jest.fn().mockResolvedValue({ response: aiResponse ?? '{}' }),
    },
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
// sha256Hex
// ---------------------------------------------------------------------------
describe('sha256Hex', () => {
  it('produces a stable 64-char hex digest', async () => {
    const a = await sha256Hex('hello world');
    const b = await sha256Hex('hello world');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different content', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
  });
});

// ---------------------------------------------------------------------------
// createChangeset
// ---------------------------------------------------------------------------
describe('createChangeset', () => {
  it('writes 1 changeset row + N file rows with correct after-hashes', async () => {
    const env = makeEnv();
    // getHeadChangesetId → null (no prior head); resolveSlug → slug row
    mockQueryOne
      .mockResolvedValueOnce(null) // getHeadChangesetId
      .mockResolvedValueOnce({ slug: 'vitos-mens-salon' }); // resolveSlug

    const files = [
      { path: 'index.html', content: '<h1>Hi</h1>' },
      { path: 'styles.css', content: 'body{color:#000}' },
    ];

    const id = await createChangeset(env, {
      siteId: 'site_1',
      chatId: 'chat_1',
      userId: 'user_1',
      prompt: 'make hero darker',
      files,
    });

    expect(typeof id).toBe('string');

    // 1 changeset insert + 2 file inserts = 3 total
    expect(mockInsert).toHaveBeenCalledTimes(3);

    // First insert = the changeset row
    const changesetCall = mockInsert.mock.calls[0];
    expect(changesetCall[1]).toBe('site_changesets');
    expect(changesetCall[2]).toEqual(
      expect.objectContaining({
        site_id: 'site_1',
        chat_id: 'chat_1',
        created_by: 'user_1',
        prompt: 'make hero darker',
        status: 'applied',
        parent_changeset_id: null,
      }),
    );

    // Second insert = first file row with the correct after-hash
    const fileCall = mockInsert.mock.calls[1];
    expect(fileCall[1]).toBe('changeset_files');
    expect(fileCall[2]).toEqual(
      expect.objectContaining({
        changeset_id: id,
        file_path: 'index.html',
        after_hash: await sha256Hex('<h1>Hi</h1>'),
        op_kind: 'insert', // no prior head → no before-hash → 'insert'
      }),
    );

    // R2 bundle was persisted
    expect((env.SITES_BUCKET.put as jest.Mock)).toHaveBeenCalledWith(
      `sites/vitos-mens-salon/changesets/${id}/files.json`,
      expect.any(String),
      expect.objectContaining({ httpMetadata: { contentType: 'application/json' } }),
    );
  });

  it('parents the changeset to the current head and computes before-hash from prior bundle', async () => {
    const env = makeEnv();
    const priorHash = await sha256Hex('OLD');
    mockQueryOne
      .mockResolvedValueOnce({ id: 'cs_parent' }) // getHeadChangesetId
      .mockResolvedValueOnce({ slug: 'site-slug' }); // resolveSlug
    // previousFileHashes query → prior file rows
    mockQuery.mockResolvedValueOnce({
      data: [{ file_path: 'index.html', before_hash: null, after_hash: priorHash, op_kind: 'replace' }],
      error: null,
    });

    const id = await createChangeset(env, {
      siteId: 'site_1',
      userId: 'user_1',
      prompt: 'edit',
      files: [{ path: 'index.html', content: 'NEW' }],
    });

    const changesetCall = mockInsert.mock.calls[0];
    expect(changesetCall[2]).toEqual(
      expect.objectContaining({ parent_changeset_id: 'cs_parent' }),
    );

    const fileCall = mockInsert.mock.calls[1];
    expect(fileCall[2]).toEqual(
      expect.objectContaining({
        before_hash: priorHash,
        after_hash: await sha256Hex('NEW'),
        op_kind: 'replace', // had a before-hash → 'replace'
      }),
    );
    expect(typeof id).toBe('string');
  });

  it('throws when the changeset row fails to insert', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ slug: 's' });
    mockInsert.mockResolvedValueOnce({ error: 'D1 write failed' });

    await expect(
      createChangeset(env, {
        siteId: 'site_1',
        userId: 'user_1',
        prompt: 'p',
        files: [{ path: 'a.txt', content: 'x' }],
      }),
    ).rejects.toThrow('Failed to insert changeset');
  });
});

// ---------------------------------------------------------------------------
// getHeadChangesetId
// ---------------------------------------------------------------------------
describe('getHeadChangesetId', () => {
  it('returns the newest changeset id', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce({ id: 'cs_newest' });
    expect(await getHeadChangesetId(env, 'site_1')).toBe('cs_newest');
  });

  it('returns null when no changesets exist', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await getHeadChangesetId(env, 'site_1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// revertChangeset
// ---------------------------------------------------------------------------
describe('revertChangeset', () => {
  it('creates a new "reverted" changeset chained to the parent and preserves history', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'cs_orig',
      site_id: 'site_1',
      chat_id: 'chat_1',
      created_by: 'user_1',
      prompt: 'original edit',
      status: 'applied',
      parent_changeset_id: null,
      r2_bundle_key: 'sites/s/changesets/cs_orig/files.json',
      revert_reason: null,
      applied_at: '2026-05-28T00:00:00.000Z',
      reverted_at: null,
    });

    const revertId = await revertChangeset(env, {
      siteId: 'site_1',
      changesetId: 'cs_orig',
      userId: 'user_2',
      reason: 'looked wrong',
    });

    expect(typeof revertId).toBe('string');

    // New row inserted with status 'reverted' chained to the original
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertCall = mockInsert.mock.calls[0];
    expect(insertCall[1]).toBe('site_changesets');
    expect(insertCall[2]).toEqual(
      expect.objectContaining({
        status: 'reverted',
        parent_changeset_id: 'cs_orig',
        created_by: 'user_2',
        revert_reason: 'looked wrong',
      }),
    );

    // Original row is preserved (UPDATE stamps reverted_at — NOT a delete)
    expect(mockUpdate).toHaveBeenCalledWith(
      env.DB,
      'site_changesets',
      expect.objectContaining({ reverted_at: expect.any(String) }),
      'id = ?',
      ['cs_orig'],
    );
    // History preserved: no DELETE / soft-delete on the original
    const updateArgs = mockUpdate.mock.calls[0][2];
    expect(updateArgs).not.toHaveProperty('deleted_at');
  });

  it('throws when the target changeset is not found', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(
      revertChangeset(env, { siteId: 'site_1', changesetId: 'missing', userId: 'u' }),
    ).rejects.toThrow('Changeset not found');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('throws when the changeset is already reverted', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'cs_orig',
      site_id: 'site_1',
      chat_id: null,
      created_by: 'u',
      prompt: 'p',
      status: 'reverted',
      parent_changeset_id: null,
      r2_bundle_key: null,
      revert_reason: null,
      applied_at: '2026-05-28T00:00:00.000Z',
      reverted_at: '2026-05-28T01:00:00.000Z',
    });
    await expect(
      revertChangeset(env, { siteId: 'site_1', changesetId: 'cs_orig', userId: 'u' }),
    ).rejects.toThrow('already reverted');
  });
});

// ---------------------------------------------------------------------------
// getHistory
// ---------------------------------------------------------------------------
describe('getHistory', () => {
  it('returns an ordered list of changeset summaries', async () => {
    const env = makeEnv();
    mockQuery.mockResolvedValueOnce({
      data: [
        {
          id: 'cs_2',
          site_id: 'site_1',
          chat_id: 'chat_1',
          created_by: 'u',
          prompt: 'second',
          status: 'applied',
          parent_changeset_id: 'cs_1',
          revert_reason: null,
          applied_at: '2026-05-28T02:00:00.000Z',
          reverted_at: null,
        },
        {
          id: 'cs_1',
          site_id: 'site_1',
          chat_id: 'chat_1',
          created_by: 'u',
          prompt: 'first',
          status: 'applied',
          parent_changeset_id: null,
          revert_reason: null,
          applied_at: '2026-05-28T01:00:00.000Z',
          reverted_at: null,
        },
      ],
      error: null,
    });

    const history = await getHistory(env, 'site_1');
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe('cs_2');
    expect(history[0].parentChangesetId).toBe('cs_1');
    expect(history[1].id).toBe('cs_1');
    expect(history[1].status).toBe('applied');

    // ORDER BY applied_at DESC was issued
    const sql = mockQuery.mock.calls[0][1] as string;
    expect(sql).toMatch(/ORDER BY applied_at DESC/);
  });

  it('returns an empty list when there are no changesets', async () => {
    const env = makeEnv();
    mockQuery.mockResolvedValueOnce({ data: [], error: null });
    expect(await getHistory(env, 'site_1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getChangesetDiff
// ---------------------------------------------------------------------------
describe('getChangesetDiff', () => {
  it('returns per-file before/after hashes for a changeset', async () => {
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
      data: [
        { file_path: 'index.html', before_hash: 'aaa', after_hash: 'bbb', op_kind: 'replace' },
      ],
      error: null,
    });

    const diff = await getChangesetDiff(env, 'cs_1');
    expect(diff).not.toBeNull();
    expect(diff!.changeset.id).toBe('cs_1');
    expect(diff!.files).toEqual([
      { filePath: 'index.html', beforeHash: 'aaa', afterHash: 'bbb', opKind: 'replace' },
    ]);
  });

  it('returns null when the changeset is missing', async () => {
    const env = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await getChangesetDiff(env, 'missing')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractEditIntent
// ---------------------------------------------------------------------------
describe('extractEditIntent', () => {
  it('uses the fp8-fast Workers AI alias', async () => {
    const env = makeEnv(
      JSON.stringify({
        rationale: 'darken hero',
        targetFiles: ['index.html'],
        operations: [{ file: 'index.html', kind: 'replace', description: 'darken' }],
        confidence: 0.9,
      }),
    );

    await extractEditIntent(env, { prompt: 'make hero darker', fileList: ['index.html'] });

    expect(env.AI.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      expect.objectContaining({ max_tokens: 1024 }),
    );
  });

  it('clamps confidence above 1 down to 1', async () => {
    const env = makeEnv(
      JSON.stringify({
        rationale: 'x',
        targetFiles: ['index.html'],
        operations: [{ file: 'index.html', kind: 'replace', description: 'd' }],
        confidence: 1.7,
      }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: ['index.html'] });
    expect(intent.confidence).toBe(1);
  });

  it('clamps negative confidence up to 0', async () => {
    const env = makeEnv(
      JSON.stringify({ rationale: 'x', targetFiles: [], operations: [], confidence: -3 }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.confidence).toBe(0);
  });

  it('drops operations whose target file is not in the file list', async () => {
    const env = makeEnv(
      JSON.stringify({
        rationale: 'x',
        targetFiles: ['index.html', 'ghost.tsx'],
        operations: [
          { file: 'index.html', kind: 'replace', description: 'd' },
          { file: 'ghost.tsx', kind: 'insert', description: 'hallucinated' },
        ],
        confidence: 0.5,
      }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: ['index.html'] });
    expect(intent.operations).toHaveLength(1);
    expect(intent.operations[0].file).toBe('index.html');
    expect(intent.targetFiles).toEqual(['index.html']);
  });

  it('parses JSON wrapped in markdown fences', async () => {
    const env = makeEnv(
      '```json\n{"rationale":"x","targetFiles":[],"operations":[],"confidence":0.4}\n```',
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: [] });
    expect(intent.confidence).toBe(0.4);
    expect(intent.rationale).toBe('x');
  });

  it('coerces an unknown operation kind to "replace"', async () => {
    const env = makeEnv(
      JSON.stringify({
        rationale: 'x',
        targetFiles: ['a.txt'],
        operations: [{ file: 'a.txt', kind: 'frobnicate', description: 'd' }],
        confidence: 0.5,
      }),
    );
    const intent = await extractEditIntent(env, { prompt: 'p', fileList: ['a.txt'] });
    expect(intent.operations[0].kind).toBe('replace');
  });

  it('throws on an empty model response', async () => {
    const env = makeEnv('');
    await expect(
      extractEditIntent(env, { prompt: 'p', fileList: [] }),
    ).rejects.toThrow('empty response');
  });

  it('throws when the model returns no JSON object', async () => {
    const env = makeEnv('I could not produce JSON.');
    await expect(
      extractEditIntent(env, { prompt: 'p', fileList: [] }),
    ).rejects.toThrow('No JSON object');
  });
});
