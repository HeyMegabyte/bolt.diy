/**
 * §42/ADR-0019 — email-router suppression enforcement (pipeline layer 4).
 * sendTransactional consults isSuppressed before delegating: a suppressed
 * recipient is skipped (inner provider NOT called, accepted:false); a clean
 * recipient sends; a lookup ERROR fails OPEN (sends anyway — never block real
 * mail on a suppression-store hiccup).
 */
jest.mock('../services/email_suppressions.js', () => ({
  isSuppressed: jest.fn(),
  recordSuppressions: jest.fn(),
}));

import { getEmailProvider } from '../platform/email-router.js';
import { isSuppressed } from '../services/email_suppressions.js';
import type { EmailProvider } from '../platform/email.js';
import type { Env } from '../types/env.js';

const mockIsSuppressed = isSuppressed as jest.MockedFunction<typeof isSuppressed>;

function spyProvider(): EmailProvider & { sent: number } {
  const p = {
    sent: 0,
    async sendTransactional() {
      p.sent += 1;
      return { id: 'sent-1', accepted: true };
    },
  };
  return p;
}

const envWithDb = { DB: {} as unknown } as Env;
const send = { kind: 'receipt' as const, to: 'user@example.com', subject: 'Hi', html: '<p>x</p>' };

beforeEach(() => jest.clearAllMocks());

describe('email-router suppression enforcement', () => {
  it('skips a suppressed recipient — inner provider NOT called, accepted:false', async () => {
    mockIsSuppressed.mockResolvedValue(true);
    const inner = spyProvider();
    const r = await getEmailProvider(envWithDb, { transactional: inner }).sendTransactional(send);
    expect(inner.sent).toBe(0);
    expect(r.accepted).toBe(false);
    expect(r.id).toContain('suppressed:');
  });

  it('sends to a clean (non-suppressed) recipient', async () => {
    mockIsSuppressed.mockResolvedValue(false);
    const inner = spyProvider();
    const r = await getEmailProvider(envWithDb, { transactional: inner }).sendTransactional(send);
    expect(inner.sent).toBe(1);
    expect(r.accepted).toBe(true);
  });

  it('FAILS OPEN — a suppression-lookup error still sends', async () => {
    mockIsSuppressed.mockRejectedValue(new Error('d1 down'));
    const inner = spyProvider();
    const r = await getEmailProvider(envWithDb, { transactional: inner }).sendTransactional(send);
    expect(inner.sent).toBe(1);
    expect(r.accepted).toBe(true);
  });

  it('skips the check entirely when there is no DB binding (no throw)', async () => {
    const inner = spyProvider();
    const r = await getEmailProvider({} as Env, { transactional: inner }).sendTransactional(send);
    expect(inner.sent).toBe(1);
    expect(mockIsSuppressed).not.toHaveBeenCalled();
    expect(r.accepted).toBe(true);
  });
});
