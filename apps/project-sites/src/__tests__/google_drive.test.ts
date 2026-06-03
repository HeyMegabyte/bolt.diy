/**
 * google_drive — read-only Google Drive integration for per-site AI Chat context.
 *
 * Covers OAuth URL build, code-for-tokens exchange + refresh, encrypted token
 * persistence (insert vs update, with/without refresh token), the decrypt /
 * refresh-on-corruption access-token resolver, folder + file listing (query
 * filters, MIME handling, empty/edge data, auth headers), and file download.
 *
 * The AES-GCM round-trip uses REAL Node 22 WebCrypto (`crypto.subtle`) via
 * `services/ai_crypto.ts`, exactly like the live Workers runtime — only the
 * D1 binding and the global `fetch` are mocked.
 */

import {
  DRIVE_SCOPE,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  persistTokens,
  getAccessToken,
  listFolders,
  listFolderFiles,
  downloadFile,
  type GoogleTokenResponse,
} from '../services/google_drive.js';
import { encrypt } from '../services/ai_crypto.js';
import type { Env } from '../types/env.js';

/** Build a minimally-typed Env stub with a real 32-byte AES key (base64). */
function makeEnv(extra: Record<string, unknown> = {}): Env {
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) keyBytes[i] = i + 1;
  let keyB64 = '';
  for (const byte of keyBytes) keyB64 += String.fromCharCode(byte);
  return {
    DB: {} as D1Database,
    MCP_ENCRYPTION_KEY: btoa(keyB64),
    GOOGLE_CLIENT_ID: 'client-id-123',
    GOOGLE_CLIENT_SECRET: 'client-secret-456',
    ...extra,
  } as unknown as Env;
}

/** A complete Google token response. */
function tokenResponse(overrides: Partial<GoogleTokenResponse> = {}): GoogleTokenResponse {
  return {
    access_token: 'access-tok',
    refresh_token: 'refresh-tok',
    expires_in: 3600,
    scope: DRIVE_SCOPE,
    token_type: 'Bearer',
    ...overrides,
  };
}

/** Minimal D1-like prepare/bind/first/run stub captured for assertions. */
function makeDbStub() {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const firstQueue: unknown[] = [];
  const db = {
    prepare(sql: string) {
      const record = { sql, binds: [] as unknown[] };
      calls.push(record);
      const stmt = {
        bind(...args: unknown[]) {
          record.binds = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return (firstQueue.length ? firstQueue.shift() : null) as T | null;
        },
        async run() {
          return { success: true };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return {
    db,
    calls,
    /** Enqueue the next `.first()` return value (FIFO). */
    queueFirst(v: unknown) {
      firstQueue.push(v);
    },
  };
}

/** Stub a `fetch` Response. */
function fetchOk(body: unknown, opts: { arrayBuffer?: ArrayBuffer } = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
    async arrayBuffer() {
      return opts.arrayBuffer ?? new ArrayBuffer(0);
    },
  } as unknown as Response;
}

function fetchErr(status: number, text = 'boom') {
  return {
    ok: false,
    status,
    async json() {
      return {};
    },
    async text() {
      return text;
    },
    async arrayBuffer() {
      return new ArrayBuffer(0);
    },
  } as unknown as Response;
}

const realFetch = global.fetch;
afterAll(() => {
  global.fetch = realFetch;
});
beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
});

const mockFetch = () => global.fetch as unknown as jest.Mock;

describe('google_drive — constants + buildAuthUrl', () => {
  it('exposes the read-only Drive scope', () => {
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.readonly');
  });

  it('builds a consent URL with all required OAuth params', () => {
    const url = buildAuthUrl(makeEnv(), 'state-xyz', 'https://app.test/cb');
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(parsed.searchParams.get('client_id')).toBe('client-id-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.test/cb');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('include_granted_scopes')).toBe('true');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('state')).toBe('state-xyz');
  });
});

describe('google_drive — exchangeCode', () => {
  it('POSTs to the token endpoint with the auth-code grant and parses the result', async () => {
    mockFetch().mockResolvedValueOnce(fetchOk(tokenResponse()));
    const tokens = await exchangeCode(makeEnv(), 'auth-code', 'https://app.test/cb');
    expect(tokens.access_token).toBe('access-tok');
    expect(tokens.refresh_token).toBe('refresh-tok');
    const [url, init] = mockFetch().mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('client_id')).toBe('client-id-123');
    expect(body.get('client_secret')).toBe('client-secret-456');
    expect(body.get('redirect_uri')).toBe('https://app.test/cb');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('throws with status + truncated body on a non-200 exchange', async () => {
    mockFetch().mockResolvedValueOnce(fetchErr(400, 'invalid_grant detail'));
    await expect(exchangeCode(makeEnv(), 'bad', 'https://app.test/cb')).rejects.toThrow(
      /google_token_exchange_failed: 400/,
    );
  });

  it('propagates a network throw', async () => {
    mockFetch().mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(exchangeCode(makeEnv(), 'c', 'https://app.test/cb')).rejects.toThrow(
      'ECONNRESET',
    );
  });
});

describe('google_drive — refreshAccessToken', () => {
  it('POSTs the refresh_token grant and parses the fresh access token', async () => {
    mockFetch().mockResolvedValueOnce(
      fetchOk(tokenResponse({ access_token: 'fresh-tok', refresh_token: undefined })),
    );
    const tokens = await refreshAccessToken(makeEnv(), 'old-refresh');
    expect(tokens.access_token).toBe('fresh-tok');
    const [url, init] = mockFetch().mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('refresh_token')).toBe('old-refresh');
    expect(body.get('grant_type')).toBe('refresh_token');
  });

  it('throws on a non-200 refresh', async () => {
    mockFetch().mockResolvedValueOnce(fetchErr(401));
    await expect(refreshAccessToken(makeEnv(), 'r')).rejects.toThrow(
      'google_token_refresh_failed: 401',
    );
  });

  it('propagates a network throw on refresh', async () => {
    mockFetch().mockRejectedValueOnce(new Error('timeout'));
    await expect(refreshAccessToken(makeEnv(), 'r')).rejects.toThrow('timeout');
  });
});

describe('google_drive — persistTokens', () => {
  it('UPDATEs both columns when a row exists and a refresh token is present', async () => {
    const { db, calls, queueFirst } = makeDbStub();
    queueFirst({ 1: 1 }); // SELECT 1 -> existing row found
    await persistTokens(makeEnv(), db, 'site-1', tokenResponse());
    const update = calls.find((c) => c.sql.includes('UPDATE'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('drive_access_token_enc');
    expect(update!.sql).toContain('drive_refresh_token_enc');
    // last bind is the site id; first two binds are encrypted (not plaintext)
    expect(update!.binds[update!.binds.length - 1]).toBe('site-1');
    expect(update!.binds[0]).not.toBe('access-tok');
    expect(typeof update!.binds[0]).toBe('string');
  });

  it('UPDATEs only the access column when no refresh token is returned', async () => {
    const { db, calls, queueFirst } = makeDbStub();
    queueFirst({ 1: 1 });
    await persistTokens(
      makeEnv(),
      db,
      'site-2',
      tokenResponse({ refresh_token: undefined }),
    );
    const update = calls.find((c) => c.sql.includes('UPDATE'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('drive_access_token_enc');
    expect(update!.sql).not.toContain('drive_refresh_token_enc');
  });

  it('INSERTs a new row when none exists (refresh encrypted, not plaintext)', async () => {
    const { db, calls } = makeDbStub(); // queueFirst empty -> SELECT returns null
    await persistTokens(makeEnv(), db, 'site-3', tokenResponse());
    const insert = calls.find((c) => c.sql.includes('INSERT INTO ai_site_settings'));
    expect(insert).toBeDefined();
    expect(insert!.binds[0]).toBe('site-3');
    expect(insert!.binds[1]).not.toBe('access-tok'); // encrypted
    expect(insert!.binds[2]).not.toBe('refresh-tok'); // encrypted
  });

  it('INSERTs a null refresh column when no refresh token is returned', async () => {
    const { db, calls } = makeDbStub();
    await persistTokens(
      makeEnv(),
      db,
      'site-4',
      tokenResponse({ refresh_token: undefined }),
    );
    const insert = calls.find((c) => c.sql.includes('INSERT INTO ai_site_settings'));
    expect(insert).toBeDefined();
    expect(insert!.binds[2]).toBeNull();
  });
});

describe('google_drive — getAccessToken', () => {
  it('returns null when the site has no settings row', async () => {
    const { db } = makeDbStub(); // SELECT -> null
    const out = await getAccessToken(makeEnv(), db, 'site-x');
    expect(out).toBeNull();
  });

  it('returns null when the row exists but has no encrypted access token', async () => {
    const { db, queueFirst } = makeDbStub();
    queueFirst({ drive_access_token_enc: null, drive_refresh_token_enc: null });
    const out = await getAccessToken(makeEnv(), db, 'site-y');
    expect(out).toBeNull();
  });

  it('decrypts and returns a valid stored access token', async () => {
    const env = makeEnv();
    const enc = await encrypt(env, 'plain-access');
    const { db, queueFirst } = makeDbStub();
    queueFirst({ drive_access_token_enc: enc, drive_refresh_token_enc: null });
    const out = await getAccessToken(env, db, 'site-z');
    expect(out).toBe('plain-access');
  });

  it('refreshes when the stored access token is corrupt but a refresh token exists', async () => {
    const env = makeEnv();
    const refreshEnc = await encrypt(env, 'stored-refresh');
    const { db, queueFirst } = makeDbStub();
    // First SELECT (getAccessToken) -> corrupt access + valid refresh
    queueFirst({ drive_access_token_enc: 'not-base64-#$%', drive_refresh_token_enc: refreshEnc });
    // persistTokens SELECT 1 -> existing row
    queueFirst({ 1: 1 });
    mockFetch().mockResolvedValueOnce(fetchOk(tokenResponse({ access_token: 'refreshed-tok' })));
    const out = await getAccessToken(env, db, 'site-r');
    expect(out).toBe('refreshed-tok');
    expect(mockFetch()).toHaveBeenCalledTimes(1); // the refresh call
  });

  it('returns null when the access token is corrupt and no refresh token exists', async () => {
    const { db, queueFirst } = makeDbStub();
    queueFirst({ drive_access_token_enc: 'garbage', drive_refresh_token_enc: null });
    const out = await getAccessToken(makeEnv(), db, 'site-n');
    expect(out).toBeNull();
  });
});

describe('google_drive — listFolders', () => {
  it('queries with folder mime + trashed filter and maps the result', async () => {
    mockFetch().mockResolvedValueOnce(
      fetchOk({
        files: [{ id: 'f1', name: 'Docs', modifiedTime: '2026-01-01T00:00:00Z' }],
      }),
    );
    const out = await listFolders('tok', undefined);
    expect(out).toEqual([{ id: 'f1', name: 'Docs', modified_time: '2026-01-01T00:00:00Z' }]);
    const [url, init] = mockFetch().mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://www.googleapis.com/drive/v3/files');
    expect(init.headers.authorization).toBe('Bearer tok');
    const q = parsed.searchParams.get('q')!;
    expect(q).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(q).toContain('trashed = false');
    expect(q).not.toContain('name contains');
    expect(parsed.searchParams.get('orderBy')).toBe('modifiedTime desc');
  });

  it('appends a name-contains clause and escapes single quotes in the query', async () => {
    mockFetch().mockResolvedValueOnce(fetchOk({ files: [] }));
    await listFolders('tok', "O'Brien");
    const parsed = new URL(mockFetch().mock.calls[0][0]);
    const q = parsed.searchParams.get('q')!;
    expect(q).toContain("name contains 'O\\'Brien'");
  });

  it('returns an empty array when Drive returns no folders', async () => {
    mockFetch().mockResolvedValueOnce(fetchOk({ files: [] }));
    expect(await listFolders('tok', undefined)).toEqual([]);
  });

  it('throws on a non-200 folder list', async () => {
    mockFetch().mockResolvedValueOnce(fetchErr(403));
    await expect(listFolders('tok', undefined)).rejects.toThrow(
      'drive_list_folders_failed: 403',
    );
  });

  it('propagates a network throw', async () => {
    mockFetch().mockRejectedValueOnce(new Error('dns'));
    await expect(listFolders('tok', undefined)).rejects.toThrow('dns');
  });
});

describe('google_drive — listFolderFiles', () => {
  it('filters to the folder parent + PDF/image MIME types and maps fields', async () => {
    mockFetch().mockResolvedValueOnce(
      fetchOk({
        files: [
          {
            id: 'd1',
            name: 'spec.pdf',
            mimeType: 'application/pdf',
            modifiedTime: '2026-02-02T00:00:00Z',
            size: '2048',
          },
        ],
      }),
    );
    const out = await listFolderFiles('tok', 'folder-9');
    expect(out).toEqual([
      {
        id: 'd1',
        name: 'spec.pdf',
        mime_type: 'application/pdf',
        modified_time: '2026-02-02T00:00:00Z',
        size: 2048,
      },
    ]);
    const parsed = new URL(mockFetch().mock.calls[0][0]);
    const q = parsed.searchParams.get('q')!;
    expect(q).toContain("'folder-9' in parents");
    expect(q).toContain('trashed = false');
    expect(q).toContain("mimeType = 'application/pdf' or mimeType contains 'image/'");
    expect(parsed.searchParams.get('pageSize')).toBe('200');
  });

  it('defaults size to 0 when the file omits a size field', async () => {
    mockFetch().mockResolvedValueOnce(
      fetchOk({
        files: [
          {
            id: 'd2',
            name: 'pic.png',
            mimeType: 'image/png',
            modifiedTime: '2026-03-03T00:00:00Z',
          },
        ],
      }),
    );
    const out = await listFolderFiles('tok', 'folder-1');
    expect(out[0].size).toBe(0);
    expect(out[0].mime_type).toBe('image/png');
  });

  it('returns an empty array for an empty folder', async () => {
    mockFetch().mockResolvedValueOnce(fetchOk({ files: [] }));
    expect(await listFolderFiles('tok', 'empty')).toEqual([]);
  });

  it('throws on a non-200 file list', async () => {
    mockFetch().mockResolvedValueOnce(fetchErr(500));
    await expect(listFolderFiles('tok', 'f')).rejects.toThrow('drive_list_files_failed: 500');
  });

  it('propagates a network throw', async () => {
    mockFetch().mockRejectedValueOnce(new Error('reset'));
    await expect(listFolderFiles('tok', 'f')).rejects.toThrow('reset');
  });
});

describe('google_drive — downloadFile', () => {
  it('requests alt=media with a URL-encoded file id and returns the bytes', async () => {
    const buf = new TextEncoder().encode('PDF-BYTES').buffer;
    mockFetch().mockResolvedValueOnce(fetchOk({}, { arrayBuffer: buf }));
    const out = await downloadFile('tok', 'file id/with?chars');
    expect(out).toBe(buf);
    const [url, init] = mockFetch().mock.calls[0];
    expect(url).toContain(encodeURIComponent('file id/with?chars'));
    expect(url).toContain('alt=media');
    expect(init.headers.authorization).toBe('Bearer tok');
  });

  it('throws on a non-200 download', async () => {
    mockFetch().mockResolvedValueOnce(fetchErr(404));
    await expect(downloadFile('tok', 'f')).rejects.toThrow('drive_download_failed: 404');
  });

  it('propagates a network throw', async () => {
    mockFetch().mockRejectedValueOnce(new Error('offline'));
    await expect(downloadFile('tok', 'f')).rejects.toThrow('offline');
  });
});
