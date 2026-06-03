/**
 * Unit tests for the Neon REST API client
 * ({@link services/neon_provisioner.ts}).
 *
 * Covers every branch:
 *   - neonKey gating: missing key, whitespace-only key → MissingNeonKeyError
 *     (code/service/deeplink envelope); present key is trimmed
 *   - createProject: request build (URL, method, Bearer auth, Content-Type,
 *     Accept, name 64-char truncation, pg_version body), connection-string
 *     return + parsed host/db/user/password, role/db fallbacks when the URI
 *     omits them, default `neondb` database name, missing-key throw,
 *     non-200 / no project.id error, network-throw resilience, non-JSON body
 *   - deleteProject: request build (URL encoding, method, Bearer auth),
 *     missing-key throw, success on 200, idempotent 404-as-success,
 *     non-404 error with truncated body, network-throw resilience
 *
 * Mocks the Neon REST calls via `global.fetch` — never hits the real API.
 */

import type { Env } from '../types/env.js';
import {
  createProject,
  deleteProject,
  MissingNeonKeyError,
  type NeonProvisionResult,
} from '../services/neon_provisioner.js';

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const NEON_DEEPLINK = 'https://console.neon.tech/app/settings/api-keys';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const keyEnv = (key = 'neon-key-abc'): Env =>
  ({ NEON_API_KEY: key }) as unknown as Env;

const noKeyEnv = (): Env => ({}) as unknown as Env;

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

const successBody = (overrides: Record<string, unknown> = {}) => ({
  project: { id: 'proj-123' },
  connection_uris: [
    {
      connection_uri:
        'postgres://neon_user:s3cr3t@ep-cool-1.us-east-2.aws.neon.tech/neondb?sslmode=require',
    },
  ],
  ...overrides,
});

// ─── MissingNeonKeyError envelope ────────────────────────────

describe('MissingNeonKeyError', () => {
  it('carries the structured missing_env envelope + deeplink', () => {
    const err = new MissingNeonKeyError();
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('missing_env');
    expect(err.service).toBe('neon');
    expect(err.deeplink).toBe(NEON_DEEPLINK);
    expect(err.message).toContain(NEON_DEEPLINK);
    expect(err.message).toContain('wrangler secret put NEON_API_KEY');
  });
});

// ─── createProject ───────────────────────────────────────────

describe('createProject', () => {
  it('throws MissingNeonKeyError when NEON_API_KEY is absent (no fetch)', async () => {
    await expect(createProject(noKeyEnv(), 'my-app')).rejects.toBeInstanceOf(
      MissingNeonKeyError,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws MissingNeonKeyError when NEON_API_KEY is whitespace-only', async () => {
    await expect(createProject(keyEnv('   '), 'my-app')).rejects.toBeInstanceOf(
      MissingNeonKeyError,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('builds the correct POST request with Bearer auth + pg_version body', async () => {
    mockFetchOnce(successBody(), { ok: true, status: 201 });
    await createProject(keyEnv('  neon-key-abc  '), 'My Cool App');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${NEON_API_BASE}/projects`);
    expect(init.method).toBe('POST');
    // Key is trimmed before use.
    expect(init.headers.Authorization).toBe('Bearer neon-key-abc');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Accept).toBe('application/json');
    const payload = JSON.parse(init.body);
    expect(payload.project.name).toBe('My Cool App');
    expect(payload.project.pg_version).toBe(16);
  });

  it('truncates the project name to 64 chars', async () => {
    mockFetchOnce(successBody(), { ok: true, status: 201 });
    const longName = 'x'.repeat(100);
    await createProject(keyEnv(), longName);
    const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(payload.project.name).toHaveLength(64);
  });

  it('returns the connection string + parsed host/db/user/password', async () => {
    mockFetchOnce(successBody(), { ok: true, status: 201 });
    const res: NeonProvisionResult = await createProject(keyEnv(), 'app');
    expect(res).toEqual({
      projectId: 'proj-123',
      connectionString:
        'postgres://neon_user:s3cr3t@ep-cool-1.us-east-2.aws.neon.tech/neondb?sslmode=require',
      host: 'ep-cool-1.us-east-2.aws.neon.tech',
      database: 'neondb',
      user: 'neon_user',
      password: 's3cr3t',
    });
  });

  it('decodes percent-encoded user + password in the URI', async () => {
    mockFetchOnce(
      successBody({
        connection_uris: [
          {
            connection_uri:
              'postgresql://a%40b:p%40ss@host.neon.tech/db1?sslmode=require',
          },
        ],
      }),
      { ok: true, status: 201 },
    );
    const res = await createProject(keyEnv(), 'app');
    expect(res.user).toBe('a@b');
    expect(res.password).toBe('p@ss');
    expect(res.host).toBe('host.neon.tech');
    expect(res.database).toBe('db1');
  });

  it('falls back to role name/password + neondb when the URI is unparseable', async () => {
    mockFetchOnce(
      {
        project: { id: 'proj-456' },
        connection_uris: [{ connection_uri: 'not-a-postgres-uri' }],
        roles: [{ name: 'fallback_role', password: 'fallback_pass' }],
      },
      { ok: true, status: 201 },
    );
    const res = await createProject(keyEnv(), 'app');
    expect(res.projectId).toBe('proj-456');
    expect(res.database).toBe('neondb');
    expect(res.user).toBe('fallback_role');
    expect(res.password).toBe('fallback_pass');
    expect(res.host).toBe('');
  });

  it('falls back to empty fields when neither URI nor roles supply them', async () => {
    mockFetchOnce(
      { project: { id: 'proj-789' } },
      { ok: true, status: 201 },
    );
    const res = await createProject(keyEnv(), 'app');
    expect(res.projectId).toBe('proj-789');
    expect(res.connectionString).toBe('');
    expect(res.host).toBe('');
    expect(res.database).toBe('neondb');
    expect(res.user).toBe('');
    expect(res.password).toBe('');
  });

  it('throws when the response is non-200', async () => {
    mockFetchOnce(
      { message: 'quota exceeded' },
      { ok: false, status: 402 },
    );
    await expect(createProject(keyEnv(), 'app')).rejects.toThrow(
      /Neon createProject failed: 402 quota exceeded/,
    );
  });

  it('throws when ok but project.id is missing', async () => {
    mockFetchOnce({ project: {} }, { ok: true, status: 200 });
    await expect(createProject(keyEnv(), 'app')).rejects.toThrow(
      /Neon createProject failed: 200/,
    );
  });

  it('handles a non-JSON response body gracefully (json throws → empty body)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(createProject(keyEnv(), 'app')).rejects.toThrow(
      /Neon createProject failed: 500/,
    );
  });

  it('propagates a network throw from fetch', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(createProject(keyEnv(), 'app')).rejects.toThrow('ECONNRESET');
  });
});

// ─── deleteProject ───────────────────────────────────────────

describe('deleteProject', () => {
  it('throws MissingNeonKeyError when NEON_API_KEY is absent (no fetch)', async () => {
    await expect(deleteProject(noKeyEnv(), 'proj-123')).rejects.toBeInstanceOf(
      MissingNeonKeyError,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('builds the correct DELETE request with Bearer auth + URL-encoded id', async () => {
    mockFetchOnce({}, { ok: true, status: 200 });
    await deleteProject(keyEnv(), 'proj/weird id');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${NEON_API_BASE}/projects/${encodeURIComponent('proj/weird id')}`);
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe('Bearer neon-key-abc');
    expect(init.headers.Accept).toBe('application/json');
  });

  it('resolves on a 200 success', async () => {
    mockFetchOnce({}, { ok: true, status: 200 });
    await expect(deleteProject(keyEnv(), 'proj-123')).resolves.toBeUndefined();
  });

  it('treats a 404 as success (idempotent destroy)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'not found',
    });
    await expect(deleteProject(keyEnv(), 'proj-gone')).resolves.toBeUndefined();
  });

  it('throws with a truncated body on a non-404 failure', async () => {
    const longBody = 'E'.repeat(500);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => longBody,
    });
    await expect(deleteProject(keyEnv(), 'proj-123')).rejects.toThrow(
      /Neon deleteProject failed: 500 E{200}$/,
    );
  });

  it('handles a body that fails to read as text (text throws → empty)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => {
        throw new Error('stream error');
      },
    });
    await expect(deleteProject(keyEnv(), 'proj-123')).rejects.toThrow(
      /Neon deleteProject failed: 503/,
    );
  });

  it('propagates a network throw from fetch', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('socket hang up'));
    await expect(deleteProject(keyEnv(), 'proj-123')).rejects.toThrow('socket hang up');
  });
});
