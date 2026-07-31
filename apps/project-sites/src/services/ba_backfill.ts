/**
 * @module services/ba_backfill
 *
 * @description
 * Pure SQL-building logic for the ONE-SHOT Better Auth ↔ legacy id-collision
 * backfill (`scripts/backfill-ba-collisions.mjs`). No I/O here — every function
 * returns SQL strings so the whole surface is unit-testable and the operator
 * script stays a thin wrangler shell.
 *
 * Background: `ensureLegacyMirror` (src/auth/better-auth.ts) mirrors NEW BA
 * users into legacy `users`/`orgs`/`memberships` under the SAME id, but SKIPS
 * (warn-only) when a legacy row already exists with the same EMAIL under a
 * DIFFERENT id — a pre-cutover account. `authMiddleware` (src/middleware/auth.ts)
 * papers over those pairs at READ time by resolving BA session → legacy id via
 * email. This module builds the data-level convergence: remap the BA-side
 * `user.id` (+ every BA child column holding that id) from ba_id → legacy_id.
 *
 * WHY this direction (BA → legacy, never legacy → BA):
 * - The LEGACY id owns the org, membership, sites, billing/subscription,
 *   audit-log and analytics history — dozens of legacy tables key `user_id`
 *   with no FK cascade. Rewriting those is high-blast-radius and unbounded.
 * - The BA side is small and enumerable: 8 columns across 7 tables (see
 *   {@link BA_USER_ID_COLUMNS}), all created by migration
 *   `0580_better_auth_schema.sql`.
 * - The shipped read layer already treats the legacy id as canonical; the
 *   remap makes the data match the read path, after which the middleware
 *   email-fallback becomes a no-op (kept as belt-and-braces).
 *
 * Tables deliberately EXCLUDED from the remap:
 * - `verification` — keys on `identifier` (email), holds no user id.
 * - `apikey` — `referenceId` is ORG-scoped (better-auth.ts `#22 — org-scoped
 *   API keys`); it never stores a user id, and no worker code writes it.
 * - `organization` — no user column (ownership flows through `member`).
 *
 * @see scripts/backfill-ba-collisions.mjs — operator runbook + safety rails
 * @see src/auth/better-auth.ts ensureLegacyMirror — the skip+warn this converges
 * @see src/middleware/auth.ts — read-time email → legacy-id resolution
 */
import { z } from 'zod';

/**
 * Every Better Auth column that stores a BA `user.id` value, in the exact
 * order the remap must run (children BEFORE the `user` parent row).
 *
 * Source of truth: migrations/0580_better_auth_schema.sql. All `userId`
 * columns carry `REFERENCES "user"("id") ON DELETE CASCADE`;
 * `session.impersonatedBy` (admin plugin) is the one FK-less user reference.
 *
 * @example
 * BA_USER_ID_COLUMNS.map((c) => `${c.table}.${c.column}`);
 * // ['session.userId', 'session.impersonatedBy', 'account.userId', ...]
 */
export const BA_USER_ID_COLUMNS: readonly { table: string; column: string }[] = [
  { table: 'session', column: 'userId' },
  { table: 'session', column: 'impersonatedBy' },
  { table: 'account', column: 'userId' },
  { table: 'twoFactor', column: 'userId' },
  { table: 'passkey', column: 'userId' },
  { table: 'ssoProvider', column: 'userId' },
  { table: 'member', column: 'userId' },
  { table: 'invitation', column: 'inviterId' },
];

/**
 * Character set covering BOTH id formats in play: Better Auth ids (32-char
 * alphanumeric) and legacy `crypto.randomUUID()` (36 chars incl. hyphens).
 * Rejecting anything outside this set is the FIRST injection barrier —
 * quotes, semicolons, whitespace and comment tokens can never reach the SQL.
 */
const SQL_SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * One collision pair to remap. `email` is carried for operator display ONLY —
 * it is NEVER interpolated into remap SQL (asserted by the unit tests), so it
 * stays loose (real stored values may not satisfy strict email grammar).
 */
export const CollisionPairSchema = z
  .object({
    /** Better Auth `user.id` currently holding the sessions/accounts. */
    baId: z.string().regex(SQL_SAFE_ID, 'baId must be 8-64 chars of [A-Za-z0-9_-]'),
    /** Legacy `users.id` that owns the org/membership/sites/billing history. */
    legacyId: z.string().regex(SQL_SAFE_ID, 'legacyId must be 8-64 chars of [A-Za-z0-9_-]'),
    /** Shared email (display/audit only — never embedded in remap SQL). */
    email: z.string().min(3).max(320),
  })
  .strict()
  .refine((p) => p.baId !== p.legacyId, {
    message: 'baId and legacyId are identical — pair already converged, nothing to remap',
  });

export type CollisionPair = z.infer<typeof CollisionPairSchema>;

/**
 * Shape of one row returned by {@link buildCollisionReportSql} (via
 * `wrangler d1 execute --json` → `[0].results[]`).
 */
export const CollisionReportRowSchema = z.object({
  ba_id: z.string(),
  legacy_id: z.string(),
  email: z.string(),
  session_count: z.number(),
  account_count: z.number(),
  twofactor_count: z.number(),
  passkey_count: z.number(),
  sso_count: z.number(),
  member_count: z.number(),
  invitation_count: z.number(),
  /**
   * 1 when a BA `user` row ALREADY exists under the legacy id (possible when
   * the two rows differ only by email case). The remap then becomes a MERGE:
   * children move onto the existing legacy-id row and the orphaned ba-id row
   * is left behind (the parent UPDATE no-ops via its guard) for manual review.
   */
  legacy_ba_user_exists: z.number(),
});

export type CollisionReportRow = z.infer<typeof CollisionReportRowSchema>;

/**
 * Quote a value as a SQL single-quoted string literal, doubling embedded
 * quotes. Defense-in-depth — {@link CollisionPairSchema} already rejects
 * quote-bearing ids, so for valid pairs this only ever adds the outer quotes.
 *
 * @param value - raw string to embed in SQL
 * @returns the quoted literal
 *
 * @example
 * sqlQuoted('abc123'); // "'abc123'"
 * sqlQuoted("O'Brien"); // "'O''Brien'"
 */
export function sqlQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Build the READ-ONLY collision report: every BA `user` row whose email
 * matches a live legacy `users` row under a DIFFERENT id, with per-child-table
 * dependent-row counts so the operator can see the blast radius of each pair.
 *
 * Matches are case-insensitive on email (`ensureLegacyMirror` lowercases
 * before comparing; BA may store as-entered) and exclude soft-deleted legacy
 * rows — the same visibility rule the read path uses.
 *
 * Idempotency: a converged pair (same id) no longer matches `u.id <> b.id`,
 * so re-running the report after a successful remap returns zero rows.
 *
 * @returns a single SELECT statement (no mutation)
 *
 * @example
 * const sql = buildCollisionReportSql();
 * // wrangler d1 execute project-sites-db-production --env production --remote --json --command "<sql>"
 */
export function buildCollisionReportSql(): string {
  const counts = [
    `(SELECT COUNT(*) FROM "session" WHERE "userId" = b.id) AS session_count`,
    `(SELECT COUNT(*) FROM "account" WHERE "userId" = b.id) AS account_count`,
    `(SELECT COUNT(*) FROM "twoFactor" WHERE "userId" = b.id) AS twofactor_count`,
    `(SELECT COUNT(*) FROM "passkey" WHERE "userId" = b.id) AS passkey_count`,
    `(SELECT COUNT(*) FROM "ssoProvider" WHERE "userId" = b.id) AS sso_count`,
    `(SELECT COUNT(*) FROM "member" WHERE "userId" = b.id) AS member_count`,
    `(SELECT COUNT(*) FROM "invitation" WHERE "inviterId" = b.id) AS invitation_count`,
    `(SELECT COUNT(*) FROM "user" x WHERE x.id = u.id) AS legacy_ba_user_exists`,
  ].join(',\n  ');
  return [
    `SELECT`,
    `  b.id AS ba_id,`,
    `  u.id AS legacy_id,`,
    `  b.email AS email,`,
    `  ${counts}`,
    `FROM "user" b`,
    `JOIN users u ON lower(u.email) = lower(b.email) AND u.deleted_at IS NULL`,
    `WHERE u.id <> b.id`,
    `ORDER BY b.email;`,
  ].join('\n');
}

/**
 * Build the per-pair remap statement set. MUST be executed as ONE wrangler
 * invocation (one multi-statement `--command`) so the statements run as a
 * single D1 batch (implicit transaction) — required because the BA child FKs
 * (`ON DELETE CASCADE`, no `ON UPDATE`) make any standalone UPDATE a
 * foreign-key violation. `PRAGMA defer_foreign_keys = true` (D1-supported)
 * defers enforcement to the end of that transaction.
 *
 * Ordering + guards (each is load-bearing):
 * 1. `PRAGMA defer_foreign_keys = true` first.
 * 2. CHILD updates next ({@link BA_USER_ID_COLUMNS} order), each guarded by
 *    `AND EXISTS (SELECT 1 FROM "user" WHERE "id" = <baId>)` — the guard makes
 *    every child statement a no-op once the pair has converged (idempotent),
 *    and children-first means a degraded non-transactional run can only leave
 *    "children moved, parent pending" — a state the report still detects and
 *    a re-run completes.
 * 3. PARENT `user.id` update LAST, guarded by
 *    `AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = <legacyId>)` — the
 *    idempotency guard: no-op on re-run, and no PK collision in the
 *    email-case MERGE edge (see {@link CollisionReportRowSchema}).
 *
 * @param input - candidate pair; validated with {@link CollisionPairSchema}
 * @returns ordered SQL statements (PRAGMA, children..., parent)
 * @throws {z.ZodError} when the input is not a valid, SQL-safe pair
 *
 * @example
 * const stmts = buildRemapStatements({
 *   baId: 'Ab3dEf9hIjKlMnOpQrStUvWxYz012345',
 *   legacyId: '2f6c0a4e-9d1b-4c8a-b7e5-1a2b3c4d5e6f',
 *   email: 'owner@example.com',
 * });
 * // stmts[0] === 'PRAGMA defer_foreign_keys = true;'
 * // stmts[stmts.length - 1] starts with 'UPDATE "user" SET "id" = ...'
 */
export function buildRemapStatements(input: unknown): string[] {
  const pair = CollisionPairSchema.parse(input);
  const ba = sqlQuoted(pair.baId);
  const legacy = sqlQuoted(pair.legacyId);

  const statements: string[] = ['PRAGMA defer_foreign_keys = true;'];
  for (const { table, column } of BA_USER_ID_COLUMNS) {
    statements.push(
      `UPDATE "${table}" SET "${column}" = ${legacy} ` +
        `WHERE "${column}" = ${ba} ` +
        `AND EXISTS (SELECT 1 FROM "user" WHERE "id" = ${ba});`,
    );
  }
  statements.push(
    `UPDATE "user" SET "id" = ${legacy} ` +
      `WHERE "id" = ${ba} ` +
      `AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = ${legacy});`,
  );
  return statements;
}

/**
 * Build the READ-ONLY per-pair post-remap verification query.
 * Expected after a successful remap: `ba_rows_left = 0` and
 * `legacy_rows_present = 1`. In the MERGE edge `ba_rows_left` may stay 1 with
 * zero children — the report surfaces it for manual cleanup.
 *
 * @param input - the pair that was just remapped
 * @returns a single SELECT statement (no mutation)
 * @throws {z.ZodError} when the input is not a valid, SQL-safe pair
 *
 * @example
 * buildPairVerifySql({ baId: 'a'.repeat(32), legacyId: 'b'.repeat(36), email: 'x@y.z' });
 * // SELECT (SELECT COUNT(*) FROM "user" WHERE "id" = '<ba>') AS ba_rows_left, ...
 */
export function buildPairVerifySql(input: unknown): string {
  const pair = CollisionPairSchema.parse(input);
  const ba = sqlQuoted(pair.baId);
  const legacy = sqlQuoted(pair.legacyId);
  return (
    `SELECT ` +
    `(SELECT COUNT(*) FROM "user" WHERE "id" = ${ba}) AS ba_rows_left, ` +
    `(SELECT COUNT(*) FROM "user" WHERE "id" = ${legacy}) AS legacy_rows_present;`
  );
}

/**
 * Validate one `--json` report row and convert it into a remap-ready
 * {@link CollisionPair}. Throwing (rather than skipping) is deliberate — a
 * malformed row means the report query and this module have drifted.
 *
 * @param row - one element of `wrangler d1 execute --json` `[0].results`
 * @returns the validated pair
 * @throws {z.ZodError} when the row shape or the embedded ids are invalid
 *
 * @example
 * const pair = reportRowToPair({ ba_id: 'a'.repeat(32), legacy_id: 'b'.repeat(36),
 *   email: 'x@y.z', session_count: 2, account_count: 1, twofactor_count: 0,
 *   passkey_count: 0, sso_count: 0, member_count: 0, invitation_count: 0,
 *   legacy_ba_user_exists: 0 });
 * // { baId: 'aaaa…', legacyId: 'bbbb…', email: 'x@y.z' }
 */
export function reportRowToPair(row: unknown): CollisionPair {
  const parsed = CollisionReportRowSchema.parse(row);
  return CollisionPairSchema.parse({
    baId: parsed.ba_id,
    legacyId: parsed.legacy_id,
    email: parsed.email,
  });
}
