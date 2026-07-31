/**
 * Unit tests for src/services/ba_backfill.ts — the pure SQL builders behind
 * scripts/backfill-ba-collisions.mjs (BA ↔ legacy id-collision convergence).
 *
 * Covers the four contract areas: report SQL shape, remap coverage of every
 * BA child table, idempotency guard clauses, and injection safety.
 * Pure functions — no mocks, no I/O.
 */
import { ZodError } from 'zod';
import {
  BA_USER_ID_COLUMNS,
  CollisionPairSchema,
  buildCollisionReportSql,
  buildPairVerifySql,
  buildRemapStatements,
  reportRowToPair,
  sqlQuoted,
} from '../services/ba_backfill.js';

const BA_ID = 'Ab3dEf9hIjKlMnOpQrStUvWxYz012345'; // BA-style 32-char id
const LEGACY_ID = '2f6c0a4e-9d1b-4c8a-b7e5-1a2b3c4d5e6f'; // legacy randomUUID
const PAIR = { baId: BA_ID, legacyId: LEGACY_ID, email: 'owner@example.com' };

const REPORT_ROW = {
  ba_id: BA_ID,
  legacy_id: LEGACY_ID,
  email: 'owner@example.com',
  session_count: 2,
  account_count: 1,
  twofactor_count: 0,
  passkey_count: 0,
  sso_count: 0,
  member_count: 1,
  invitation_count: 0,
  legacy_ba_user_exists: 0,
};

describe('ba_backfill — collision report SQL', () => {
  const sql = buildCollisionReportSql();

  it('selects the pair columns under stable aliases', () => {
    expect(sql).toContain('b.id AS ba_id');
    expect(sql).toContain('u.id AS legacy_id');
    expect(sql).toContain('b.email AS email');
  });

  it('joins BA "user" to legacy users case-insensitively on email, live rows only', () => {
    expect(sql).toContain('FROM "user" b');
    expect(sql).toContain('JOIN users u ON lower(u.email) = lower(b.email)');
    expect(sql).toContain('u.deleted_at IS NULL');
  });

  it('only reports rows whose ids DIFFER (converged pairs vanish — idempotent)', () => {
    expect(sql).toContain('WHERE u.id <> b.id');
  });

  it('counts dependent rows for every FK child table plus the merge-edge flag', () => {
    expect(sql).toContain('FROM "session" WHERE "userId" = b.id) AS session_count');
    expect(sql).toContain('FROM "account" WHERE "userId" = b.id) AS account_count');
    expect(sql).toContain('FROM "twoFactor" WHERE "userId" = b.id) AS twofactor_count');
    expect(sql).toContain('FROM "passkey" WHERE "userId" = b.id) AS passkey_count');
    expect(sql).toContain('FROM "ssoProvider" WHERE "userId" = b.id) AS sso_count');
    expect(sql).toContain('FROM "member" WHERE "userId" = b.id) AS member_count');
    expect(sql).toContain('FROM "invitation" WHERE "inviterId" = b.id) AS invitation_count');
    expect(sql).toContain('AS legacy_ba_user_exists');
  });

  it('is a single read-only SELECT — no mutation keywords', () => {
    expect(sql.trimStart().startsWith('SELECT')).toBe(true);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP|PRAGMA)\b/);
  });
});

describe('ba_backfill — remap statement set', () => {
  const statements = buildRemapStatements(PAIR);

  it('opens with the FK-deferral pragma (child FKs have no ON UPDATE cascade)', () => {
    expect(statements[0]).toBe('PRAGMA defer_foreign_keys = true;');
  });

  it('emits exactly pragma + one UPDATE per child column + one parent UPDATE', () => {
    expect(statements).toHaveLength(1 + BA_USER_ID_COLUMNS.length + 1);
  });

  it('covers every BA child table/column from 0580_better_auth_schema.sql', () => {
    // Explicit expected set — fails loudly if the schema or the const drifts.
    const expected = [
      'session.userId',
      'session.impersonatedBy',
      'account.userId',
      'twoFactor.userId',
      'passkey.userId',
      'ssoProvider.userId',
      'member.userId',
      'invitation.inviterId',
    ];
    expect(BA_USER_ID_COLUMNS.map((c) => `${c.table}.${c.column}`)).toEqual(expected);
    for (const { table, column } of BA_USER_ID_COLUMNS) {
      const hit = statements.find((s) =>
        s.startsWith(
          `UPDATE "${table}" SET "${column}" = '${LEGACY_ID}' WHERE "${column}" = '${BA_ID}'`,
        ),
      );
      expect(hit).toBeDefined();
    }
  });

  it('updates children BEFORE the parent — the "user" UPDATE is the final statement', () => {
    const parentIndexes = statements
      .map((s, i) => (s.startsWith('UPDATE "user" ') ? i : -1))
      .filter((i) => i >= 0);
    expect(parentIndexes).toEqual([statements.length - 1]);
  });

  it('remaps the parent id from ba to legacy', () => {
    expect(statements[statements.length - 1]).toContain(`SET "id" = '${LEGACY_ID}'`);
    expect(statements[statements.length - 1]).toContain(`WHERE "id" = '${BA_ID}'`);
  });
});

describe('ba_backfill — idempotency guards', () => {
  const statements = buildRemapStatements(PAIR);

  it('guards every child UPDATE so it no-ops once the pair has converged', () => {
    const children = statements.slice(1, -1);
    expect(children.length).toBe(BA_USER_ID_COLUMNS.length);
    for (const stmt of children) {
      expect(stmt).toContain(`AND EXISTS (SELECT 1 FROM "user" WHERE "id" = '${BA_ID}')`);
    }
  });

  it('guards the parent UPDATE against PK collision and re-runs (NOT EXISTS legacy id)', () => {
    expect(statements[statements.length - 1]).toContain(
      `AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = '${LEGACY_ID}')`,
    );
  });

  it('rejects an already-converged pair (same id on both sides) outright', () => {
    expect(() => buildRemapStatements({ baId: BA_ID, legacyId: BA_ID, email: 'x@y.z' })).toThrow(
      ZodError,
    );
  });
});

describe('ba_backfill — injection safety', () => {
  it('rejects ids carrying quotes or statement separators', () => {
    expect(() => buildRemapStatements({ ...PAIR, baId: "abc'; DROP TABLE user;--" })).toThrow(
      ZodError,
    );
    expect(() => buildRemapStatements({ ...PAIR, legacyId: "x' OR '1'='1" })).toThrow(ZodError);
  });

  it('rejects ids with whitespace, comment tokens, or out-of-range length', () => {
    expect(() => buildRemapStatements({ ...PAIR, baId: 'abc def12' })).toThrow(ZodError);
    expect(() => buildRemapStatements({ ...PAIR, legacyId: 'abcd--12' + ' ' })).toThrow(ZodError);
    expect(() => buildRemapStatements({ ...PAIR, baId: 'short' })).toThrow(ZodError);
    expect(() => buildRemapStatements({ ...PAIR, legacyId: 'a'.repeat(65) })).toThrow(ZodError);
  });

  it('rejects unknown keys (strict schema) and non-string ids', () => {
    expect(() => buildRemapStatements({ ...PAIR, extra: 'nope' })).toThrow(ZodError);
    expect(() => buildRemapStatements({ ...PAIR, baId: 42 })).toThrow(ZodError);
  });

  it('never embeds the email in remap SQL and always single-quotes the ids', () => {
    const withQuotableEmail = { ...PAIR, email: "o'brien+admin@example.com" };
    const statements = buildRemapStatements(withQuotableEmail);
    for (const stmt of statements.slice(1)) {
      expect(stmt).not.toContain('example.com');
      expect(stmt).toContain(`'${BA_ID}'`);
      expect(stmt).toContain(`'${LEGACY_ID}'`);
    }
  });

  it('sqlQuoted doubles embedded quotes (defense-in-depth beneath the schema gate)', () => {
    expect(sqlQuoted('abc123')).toBe("'abc123'");
    expect(sqlQuoted("O'Brien")).toBe("'O''Brien'");
    expect(sqlQuoted("a'; --")).toBe("'a''; --'");
  });

  it('accepts both real-world id shapes (BA 32-char + legacy UUID)', () => {
    expect(CollisionPairSchema.safeParse(PAIR).success).toBe(true);
  });
});

describe('ba_backfill — report row parsing + pair verify SQL', () => {
  it('converts a valid report row into a remap-ready pair', () => {
    expect(reportRowToPair(REPORT_ROW)).toEqual({
      baId: BA_ID,
      legacyId: LEGACY_ID,
      email: 'owner@example.com',
    });
  });

  it('throws on drifted report rows (missing counts, wrong types, unsafe ids)', () => {
    const missingCount: Record<string, unknown> = { ...REPORT_ROW };
    delete missingCount.session_count;
    expect(() => reportRowToPair(missingCount)).toThrow(ZodError);
    expect(() => reportRowToPair({ ...REPORT_ROW, account_count: 'one' })).toThrow(ZodError);
    expect(() => reportRowToPair({ ...REPORT_ROW, ba_id: "x'; DELETE FROM user;--" })).toThrow(
      ZodError,
    );
  });

  it('buildPairVerifySql is read-only and checks both sides of the remap', () => {
    const sql = buildPairVerifySql(PAIR);
    expect(sql.startsWith('SELECT ')).toBe(true);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP|PRAGMA)\b/);
    expect(sql).toContain(`WHERE "id" = '${BA_ID}') AS ba_rows_left`);
    expect(sql).toContain(`WHERE "id" = '${LEGACY_ID}') AS legacy_rows_present`);
  });

  it('buildPairVerifySql validates its input like the remap builder', () => {
    expect(() => buildPairVerifySql({ ...PAIR, baId: "bad'id" })).toThrow(ZodError);
  });
});
