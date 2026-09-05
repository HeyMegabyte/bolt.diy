jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
}));

import { dbQuery, dbInsert } from '../services/db.js';
import {
  writeAuditLog,
  getAuditLogs,
  auditSiteLabel,
  auditSiteLabelDb,
} from '../services/audit.js';
import { createAuditLogSchema } from '@project-sites/shared';

const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;

const mockDb = {} as D1Database;

const validEntry = {
  org_id: crypto.randomUUID(),
  actor_id: crypto.randomUUID(),
  action: 'auth.login',
  target_type: 'session',
  target_id: crypto.randomUUID(),
  request_id: crypto.randomUUID(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── writeAuditLog ───────────────────────────────────────────

describe('writeAuditLog', () => {
  it('writes valid audit entry to DB', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await writeAuditLog(mockDb, validEntry);

    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        org_id: validEntry.org_id,
        action: validEntry.action,
        actor_id: validEntry.actor_id,
        target_type: validEntry.target_type,
        target_id: validEntry.target_id,
        request_id: validEntry.request_id,
      }),
    );
  });

  it('does not throw on DB failure (logs error instead)', async () => {
    mockInsert.mockResolvedValue({ error: 'DB write failed' });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(writeAuditLog(mockDb, validEntry)).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('validates entry with createAuditLogSchema', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await writeAuditLog(mockDb, validEntry);

    // Verify the row passed to dbInsert matches the schema-parsed output
    const call = mockInsert.mock.calls[0];
    const row = call[2] as Record<string, unknown>;
    const parsed = createAuditLogSchema.parse(validEntry);
    expect(row).toEqual(
      expect.objectContaining({
        org_id: parsed.org_id,
        actor_id: parsed.actor_id,
        action: parsed.action,
        target_type: parsed.target_type,
        target_id: parsed.target_id,
        request_id: parsed.request_id,
      }),
    );
  });

  it('WRITES an entry whose org_id/actor_id are non-UUID (real seed/system orgs, not just UUIDs)', async () => {
    mockInsert.mockResolvedValue({ error: null });
    // The E2E key + seed orgs resolve to a real D1 row `org_id: 'e2e-test-org'`
    // (D1 stores org_id as TEXT, not a UUID). The audit schema used to require a
    // UUID → `.parse` threw → the entry was DROPPED ("Audit log write threw
    // unexpectedly"), losing the compliance trail for every non-UUID org.
    await writeAuditLog(mockDb, {
      org_id: 'e2e-test-org',
      actor_id: 'system',
      action: 'cmdk.ai.answered',
    } as never);

    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        org_id: 'e2e-test-org',
        actor_id: 'system',
        action: 'cmdk.ai.answered',
      }),
    );
  });

  it('does not throw on invalid entry (silently logs error)', async () => {
    const invalidEntry = {
      // Missing required org_id
      action: 'auth.login',
      actor_id: null,
    } as any;

    // writeAuditLog should never throw — it catches schema validation errors internally
    await expect(writeAuditLog(mockDb, invalidEntry)).resolves.toBeUndefined();
  });

  it('adds created_at timestamp', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await writeAuditLog(mockDb, validEntry);

    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        created_at: expect.any(String),
      }),
    );

    const call = mockInsert.mock.calls[0];
    const row = call[2] as Record<string, unknown>;
    // Verify created_at is a valid ISO date
    expect(new Date(row.created_at as string).toISOString()).toBe(row.created_at);
  });
});

// ─── getAuditLogs ────────────────────────────────────────────

describe('getAuditLogs', () => {
  const orgId = crypto.randomUUID();

  it('returns data array on success', async () => {
    const logs = [
      { id: 'log-1', action: 'auth.login' },
      { id: 'log-2', action: 'billing.changed' },
    ];
    mockQuery.mockResolvedValue({ data: logs, error: null });

    const result = await getAuditLogs(mockDb, orgId);

    expect(result.data).toEqual(logs);
    expect(result.error).toBeNull();
  });

  it('returns empty array when no logs', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });

    const result = await getAuditLogs(mockDb, orgId);

    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('uses default limit=50 and offset=0', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });

    await getAuditLogs(mockDb, orgId);

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      expect.stringContaining('LIMIT'),
      expect.arrayContaining([orgId, 50, 0]),
    );
  });

  it('passes custom limit and offset', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });

    await getAuditLogs(mockDb, orgId, { limit: 10, offset: 20 });

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      expect.stringContaining('LIMIT'),
      expect.arrayContaining([orgId, 10, 20]),
    );
  });

  it('returns error when DB fails', async () => {
    mockQuery.mockResolvedValue({ data: [], error: 'Query failed' });

    const result = await getAuditLogs(mockDb, orgId);

    expect(result.data).toEqual([]);
    expect(result.error).toBe('Query failed');
  });
});

// ─── auditSiteLabel ──────────────────────────────────────────
// Audit MESSAGES must name the site by slug, never a raw UUID (which is
// meaningless in the activity feed / audit log). Regression for the MCP
// connect/disconnect messages that leaked `site_id`.

describe('auditSiteLabel', () => {
  it('returns the slug when one is known', () => {
    expect(auditSiteLabel('vito-salon', '9df831e5-fba0-48f2-a950-b4766cc7ee01')).toBe('vito-salon');
  });

  it('trims a padded slug', () => {
    expect(auditSiteLabel('  vito-salon  ', 'id-1')).toBe('vito-salon');
  });

  it('falls back to the site id when the slug is null/undefined/blank (never a blank reference)', () => {
    expect(auditSiteLabel(null, 'id-1')).toBe('id-1');
    expect(auditSiteLabel(undefined, 'id-1')).toBe('id-1');
    expect(auditSiteLabel('', 'id-1')).toBe('id-1');
    expect(auditSiteLabel('   ', 'id-1')).toBe('id-1');
  });
});

// ─── auditSiteLabelDb (async D1 variant) ─────────────────────
describe('auditSiteLabelDb', () => {
  const mkDb = (slug: string | null | undefined, throws = false): D1Database =>
    ({
      prepare: () => ({
        bind: () => ({
          first: async () => {
            if (throws) throw new Error('d1 down');
            return slug === undefined ? null : { slug };
          },
        }),
      }),
    }) as unknown as D1Database;

  it('resolves the slug from D1', async () => {
    expect(await auditSiteLabelDb(mkDb('vito-salon'), 'id-1')).toBe('vito-salon');
  });

  it('falls back to the site id when the row/slug is missing', async () => {
    expect(await auditSiteLabelDb(mkDb(null), 'id-1')).toBe('id-1');
    expect(await auditSiteLabelDb(mkDb(undefined), 'id-1')).toBe('id-1');
  });

  it('never throws — a D1 error falls back to the site id', async () => {
    expect(await auditSiteLabelDb(mkDb('x', true), 'id-1')).toBe('id-1');
  });
});
