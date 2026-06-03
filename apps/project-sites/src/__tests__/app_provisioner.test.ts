/**
 * Unit tests for the aux-infra provisioner
 * ({@link services/app_provisioner.ts}).
 *
 * Covers the extractable orchestration logic:
 *   - provisionInfra: per-InfraDep branch selection (postgres/redis/s3/
 *     sqlite/volume/mailrelay), resource-name assembly (slug + 8-char
 *     instanceId), s3 endpoint/bucket derivation from CF_ACCOUNT_ID,
 *     needsVolume toggle, mailrelay from-address, default empty result,
 *     combined multi-dep assembly
 *   - rollback semantics: a failure in the 2nd dep tears down the 1st
 *     (LIFO order), rollback swallows undo errors, no rollback fires on
 *     success, error is re-thrown after rollback
 *   - deprovisionInfra: per-id teardown, all-true on success, idempotent
 *     skip when an id is null/absent, best-effort never-throws on a failing
 *     deleter (returns {neon|upstash:false}), r2 always reported true (no-op)
 *
 * The neon_provisioner + upstash_provisioner modules are jest.mock'd so no
 * real Neon/Upstash REST calls fire. Env bindings are cast stubs.
 */

import type { Env } from '../types/env.js';
import type { InfraDep } from '../data/apps-catalog.js';

jest.mock('../services/neon_provisioner.js', () => ({
  createProject: jest.fn(),
  deleteProject: jest.fn(),
}));
jest.mock('../services/upstash_provisioner.js', () => ({
  createDatabase: jest.fn(),
  deleteDatabase: jest.fn(),
}));

import * as neon from '../services/neon_provisioner.js';
import * as upstash from '../services/upstash_provisioner.js';
import { provisionInfra, deprovisionInfra } from '../services/app_provisioner.js';

const createProject = neon.createProject as unknown as jest.Mock;
const deleteProject = neon.deleteProject as unknown as jest.Mock;
const createDatabase = upstash.createDatabase as unknown as jest.Mock;
const deleteDatabase = upstash.deleteDatabase as unknown as jest.Mock;

const env = (overrides: Record<string, unknown> = {}): Env =>
  ({ ...overrides }) as unknown as Env;

const ctx = { instanceId: 'abcdef1234567890', slug: 'my-app' };

const neonResult = {
  projectId: 'proj-123',
  connectionString: 'postgres://u:p@h/db',
  host: 'h',
  database: 'db',
  user: 'u',
  password: 'p',
};
const upstashResult = {
  databaseId: 'db-456',
  restUrl: 'https://r',
  restToken: 'tok',
  redisUrl: 'rediss://default:p@e:6379',
};

beforeEach(() => {
  jest.clearAllMocks();
  createProject.mockResolvedValue(neonResult);
  createDatabase.mockResolvedValue(upstashResult);
  deleteProject.mockResolvedValue(undefined);
  deleteDatabase.mockResolvedValue(undefined);
});

// ─── provisionInfra: branch selection + naming ───────────────

describe('provisionInfra', () => {
  it('returns the default empty result when no infra is requested', async () => {
    const res = await provisionInfra(env(), [], ctx);
    expect(res).toEqual({ needsVolume: false });
    expect(createProject).not.toHaveBeenCalled();
    expect(createDatabase).not.toHaveBeenCalled();
  });

  it('provisions a Neon project for `postgres` with slug + 8-char instanceId name', async () => {
    const res = await provisionInfra(env(), ['postgres'], ctx);
    expect(createProject).toHaveBeenCalledWith(expect.anything(), 'app-my-app-abcdef12');
    expect(res.postgres).toEqual(neonResult);
  });

  it('provisions an Upstash db for `redis` with the same name shape', async () => {
    const res = await provisionInfra(env(), ['redis'], ctx);
    expect(createDatabase).toHaveBeenCalledWith(expect.anything(), 'app-my-app-abcdef12');
    expect(res.redis).toEqual(upstashResult);
  });

  it('derives the R2 bucket + endpoint from CF_ACCOUNT_ID for `s3`', async () => {
    const res = await provisionInfra(env({ CF_ACCOUNT_ID: 'acct-9' }), ['s3'], ctx);
    expect(res.s3).toEqual({
      bucketName: 'apps-abcdef1234567890-my-app',
      accountId: 'acct-9',
      endpointUrl: 'https://acct-9.r2.cloudflarestorage.com',
      accessKeyId: '',
      secretAccessKey: '',
    });
  });

  it('lowercases + 63-char-caps the s3 bucket name', async () => {
    const longCtx = { instanceId: 'X'.repeat(40), slug: 'UPPER-SLUG' };
    const res = await provisionInfra(env({ CF_ACCOUNT_ID: 'a' }), ['s3'], longCtx);
    expect(res.s3!.bucketName).toBe(res.s3!.bucketName.toLowerCase());
    expect(res.s3!.bucketName.length).toBeLessThanOrEqual(63);
  });

  it('leaves the s3 endpoint empty when CF_ACCOUNT_ID is absent', async () => {
    const res = await provisionInfra(env(), ['s3'], ctx);
    expect(res.s3!.accountId).toBe('');
    expect(res.s3!.endpointUrl).toBe('');
  });

  it('flips needsVolume on `sqlite`', async () => {
    const res = await provisionInfra(env(), ['sqlite'], ctx);
    expect(res.needsVolume).toBe(true);
  });

  it('flips needsVolume on `volume`', async () => {
    const res = await provisionInfra(env(), ['volume'], ctx);
    expect(res.needsVolume).toBe(true);
  });

  it('sets the Resend from-address on `mailrelay` (no provisioning)', async () => {
    const res = await provisionInfra(env(), ['mailrelay'], ctx);
    expect(res.mailrelay).toEqual({ fromAddress: 'noreply@projectsites.dev' });
    expect(createProject).not.toHaveBeenCalled();
    expect(createDatabase).not.toHaveBeenCalled();
  });

  it('assembles every dep in one combined request', async () => {
    const infra: InfraDep[] = ['postgres', 'redis', 's3', 'volume', 'mailrelay'];
    const res = await provisionInfra(env({ CF_ACCOUNT_ID: 'acct-1' }), infra, ctx);
    expect(res.postgres).toEqual(neonResult);
    expect(res.redis).toEqual(upstashResult);
    expect(res.s3).toBeDefined();
    expect(res.needsVolume).toBe(true);
    expect(res.mailrelay).toBeDefined();
  });
});

// ─── provisionInfra: rollback semantics ──────────────────────

describe('provisionInfra rollback', () => {
  it('rolls back the Neon project (LIFO) when the Upstash step fails', async () => {
    createDatabase.mockRejectedValueOnce(new Error('upstash boom'));
    await expect(provisionInfra(env(), ['postgres', 'redis'], ctx)).rejects.toThrow('upstash boom');
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(deleteProject).toHaveBeenCalledWith(expect.anything(), 'proj-123');
    // The failed Upstash create never produced an id → no Upstash undo.
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it('re-throws the original error after rollback completes', async () => {
    createProject.mockRejectedValueOnce(new Error('neon boom'));
    await expect(provisionInfra(env(), ['postgres'], ctx)).rejects.toThrow('neon boom');
    // First dep failed before pushing a rollback entry → nothing to undo.
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('swallows an undo error so the original failure still surfaces', async () => {
    deleteProject.mockRejectedValueOnce(new Error('undo failed'));
    createDatabase.mockRejectedValueOnce(new Error('upstash boom'));
    await expect(provisionInfra(env(), ['postgres', 'redis'], ctx)).rejects.toThrow('upstash boom');
    expect(deleteProject).toHaveBeenCalledTimes(1);
  });

  it('fires NO rollback on a fully-successful provision', async () => {
    await provisionInfra(env(), ['postgres', 'redis'], ctx);
    expect(deleteProject).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });
});

// ─── deprovisionInfra ────────────────────────────────────────

describe('deprovisionInfra', () => {
  it('tears down both Neon + Upstash and reports all-true', async () => {
    const out = await deprovisionInfra(env(), {
      neonProjectId: 'proj-123',
      upstashDatabaseId: 'db-456',
    });
    expect(deleteProject).toHaveBeenCalledWith(expect.anything(), 'proj-123');
    expect(deleteDatabase).toHaveBeenCalledWith(expect.anything(), 'db-456');
    expect(out).toEqual({ neon: true, upstash: true, r2: true });
  });

  it('skips deleters when ids are null/absent (idempotent)', async () => {
    const out = await deprovisionInfra(env(), {
      neonProjectId: null,
      upstashDatabaseId: undefined,
      r2BucketName: 'apps-x',
    });
    expect(deleteProject).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(out).toEqual({ neon: true, upstash: true, r2: true });
  });

  it('reports neon:false and never throws when the Neon deleter fails', async () => {
    deleteProject.mockRejectedValueOnce(new Error('neon delete boom'));
    const out = await deprovisionInfra(env(), { neonProjectId: 'proj-123' });
    expect(out.neon).toBe(false);
    expect(out.upstash).toBe(true);
    expect(out.r2).toBe(true);
  });

  it('reports upstash:false and never throws when the Upstash deleter fails', async () => {
    deleteDatabase.mockRejectedValueOnce('plain string error');
    const out = await deprovisionInfra(env(), { upstashDatabaseId: 'db-456' });
    expect(out.upstash).toBe(false);
    expect(out.neon).toBe(true);
  });

  it('always reports r2:true (R2 teardown is a deliberate no-op)', async () => {
    const out = await deprovisionInfra(env(), { r2BucketName: 'apps-leftover' });
    expect(out.r2).toBe(true);
  });
});
