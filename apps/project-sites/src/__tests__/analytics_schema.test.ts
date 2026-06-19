import { ANALYTICS_DDL, ensureAnalyticsSchema } from '../services/analytics_schema.js';

describe('ANALYTICS_DDL', () => {
  it('exports at least 6 statements', () => {
    expect(ANALYTICS_DDL.length).toBeGreaterThanOrEqual(6);
  });

  it('every statement starts with CREATE TABLE IF NOT EXISTS or CREATE INDEX IF NOT EXISTS', () => {
    for (const stmt of ANALYTICS_DDL) {
      const trimmed = stmt.trimStart();
      const valid =
        trimmed.startsWith('CREATE TABLE IF NOT EXISTS') ||
        trimmed.startsWith('CREATE INDEX IF NOT EXISTS');
      expect(valid).toBe(true);
    }
  });

  it('contains all 6 required table definitions', () => {
    const tables = [
      'analytics_events',
      'dead_letter_events',
      'event_dedup',
      'provider_credentials',
      'circuit_breaker_state',
      'site_quotas',
    ];
    for (const table of tables) {
      const found = ANALYTICS_DDL.some((s) => s.includes(table));
      expect(found).toBe(true);
    }
  });
});

describe('ensureAnalyticsSchema', () => {
  it('calls db.exec once per DDL statement and returns ok:true', async () => {
    const exec = jest.fn().mockResolvedValue({});
    const db = { exec } as unknown as D1Database;

    const result = await ensureAnalyticsSchema(db);

    expect(exec).toHaveBeenCalledTimes(ANALYTICS_DDL.length);
    expect(result).toEqual({ ok: true, created: ANALYTICS_DDL.length });
  });

  it('passes each statement string to db.exec', async () => {
    const exec = jest.fn().mockResolvedValue({});
    const db = { exec } as unknown as D1Database;

    await ensureAnalyticsSchema(db);

    ANALYTICS_DDL.forEach((stmt, i) => {
      expect(exec).toHaveBeenNthCalledWith(i + 1, stmt);
    });
  });

  it('returns ok:false when db.exec rejects', async () => {
    const exec = jest.fn().mockRejectedValue(new Error('D1 error'));
    const db = { exec } as unknown as D1Database;

    const result = await ensureAnalyticsSchema(db);

    expect(result).toEqual({ ok: false, created: 0 });
  });

  it('returns ok:false and does not throw when db.exec throws synchronously', async () => {
    const exec = jest.fn().mockImplementation(() => {
      throw new Error('sync D1 error');
    });
    const db = { exec } as unknown as D1Database;

    const result = await ensureAnalyticsSchema(db);

    expect(result).toEqual({ ok: false, created: 0 });
  });
});
