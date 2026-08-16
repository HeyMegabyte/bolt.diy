/**
 * authenticateTestLogin — the E2E test sign-in seam.
 *
 * Verifies the secret-gated `brian@megabyte.space` password path that lets
 * Playwright sign in through the real UI. Safety contract: the seam is OFF
 * (throws 404) unless `E2E_TEST_PASSWORD` is provisioned, so it can never be a
 * live auth backdoor in normal prod. See [[ai-agent-security]] + [[feature-flags]].
 */
jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQueryOne } from '../services/db.js';
import { authenticateTestLogin, TEST_LOGIN_EMAIL } from '../services/auth.js';

const mockDbQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
// findOrCreateUser now creates the account via an ATOMIC db.batch (users+orgs+
// memberships), so the seam's D1 mock must expose prepare()/batch() — a bare `{}`
// throws "db.batch is not a function" on the new-user path (iter 17-22 pattern).
const mockDb = {
  prepare: (_sql: string) => ({ bind: (..._args: unknown[]) => ({}) }),
  batch: async (stmts: unknown[]) => stmts.map(() => ({ success: true, meta: { changes: 1 } })),
} as unknown as D1Database;
const PASSWORD = 'correct-horse-battery-staple-test';

beforeEach(() => {
  jest.clearAllMocks();
  mockDbQueryOne.mockResolvedValue(null); // new-user path by default
});

describe('authenticateTestLogin', () => {
  it('exposes the canonical test email', () => {
    expect(TEST_LOGIN_EMAIL).toBe('brian@megabyte.space');
  });

  it('throws 404 when E2E_TEST_PASSWORD is not provisioned (seam OFF)', async () => {
    await expect(
      authenticateTestLogin(mockDb, {} as never, { email: TEST_LOGIN_EMAIL, password: PASSWORD }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a wrong email with 401', async () => {
    await expect(
      authenticateTestLogin(mockDb, { E2E_TEST_PASSWORD: PASSWORD } as never, {
        email: 'someone@else.com',
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a wrong password with 401', async () => {
    await expect(
      authenticateTestLogin(mockDb, { E2E_TEST_PASSWORD: PASSWORD } as never, {
        email: TEST_LOGIN_EMAIL,
        password: 'wrong',
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a malformed body (ZodError) when the seam is on', async () => {
    await expect(
      authenticateTestLogin(mockDb, { E2E_TEST_PASSWORD: PASSWORD } as never, {
        email: 'not-an-email',
      }),
    ).rejects.toBeDefined();
  });

  it('mints a real session for the correct email + password', async () => {
    const out = await authenticateTestLogin(mockDb, { E2E_TEST_PASSWORD: PASSWORD } as never, {
      email: TEST_LOGIN_EMAIL,
      password: PASSWORD,
    });
    expect(out.email).toBe(TEST_LOGIN_EMAIL);
    expect(out.token).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof out.user_id).toBe('string');
    expect(out.user_id.length).toBeGreaterThan(0);
    expect(typeof out.org_id).toBe('string');
  });

  it('is case-insensitive on the email', async () => {
    const out = await authenticateTestLogin(mockDb, { E2E_TEST_PASSWORD: PASSWORD } as never, {
      email: 'Brian@Megabyte.Space',
      password: PASSWORD,
    });
    expect(out.email).toBe(TEST_LOGIN_EMAIL);
  });
});
