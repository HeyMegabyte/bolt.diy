/**
 * Unit tests for Data Export CSV.
 * Covers: RFC4180 quoting, OWASP CSV-injection neutralization, null handling,
 * tag JSON flattening, consent boolean rendering, and header-only on empty/error.
 */

import { csvCell, exportContactsCsv } from '../service.js';
import { CONTACT_EXPORT_COLUMNS } from '../schemas.js';
import type { Env } from '../../../../src/types/env.js';

describe('csvCell', () => {
  it('passes plain values through', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell('a@b.com')).toBe('a@b.com');
  });
  it('renders nullish as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('RFC4180-quotes commas, quotes, newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('she "said"')).toBe('"she ""said"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
  it('neutralizes CSV formula injection (=, +, -, @)', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    // injection guard + quoting compose: leading '=' AND a comma
    expect(csvCell('=1,2')).toBe(`"'=1,2"`);
  });
});

function makeEnv(rows: unknown[], opts: { error?: boolean } = {}): Env {
  return {
    DB: {
      prepare: (_sql: string) => ({
        bind: () => ({
          all: async () => (opts.error ? Promise.reject(new Error('no table')) : { results: rows }),
        }),
      }),
    } as unknown as D1Database,
  } as unknown as Env;
}

describe('exportContactsCsv', () => {
  const row = {
    email: 'ada@x.com',
    name: 'Ada',
    phone: '5551234567',
    source: 'inbox',
    tags: '["lead","vip"]',
    consent_email: 1,
    consent_sms: 0,
    created_at: '2026-05-01',
    last_seen_at: '2026-05-29',
  };

  it('emits a header row matching the declared columns', async () => {
    const csv = await exportContactsCsv(makeEnv([]), 'org1');
    expect(csv.split('\r\n')[0]).toBe(CONTACT_EXPORT_COLUMNS.join(','));
  });

  it('renders a contact row with flattened tags + boolean consent', async () => {
    const csv = await exportContactsCsv(makeEnv([row]), 'org1');
    const [, line] = csv.split('\r\n');
    expect(line).toBe('ada@x.com,Ada,5551234567,inbox,lead;vip,true,false,2026-05-01,2026-05-29');
  });

  it('quotes a name containing a comma', async () => {
    const csv = await exportContactsCsv(makeEnv([{ ...row, name: 'Lovelace, Ada' }]), 'org1');
    expect(csv).toContain('"Lovelace, Ada"');
  });

  it('degrades to a header-only CSV when the query errors', async () => {
    const csv = await exportContactsCsv(makeEnv([], { error: true }), 'org1');
    expect(csv).toBe(CONTACT_EXPORT_COLUMNS.join(','));
  });
});
