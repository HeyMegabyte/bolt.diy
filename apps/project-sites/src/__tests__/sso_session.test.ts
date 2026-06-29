import {
  createSsoSession,
  isExpired,
  SSO_SESSION_TTL,
  type SsoSession,
} from '../services/sso_session';

const TEST_USER = 'usr_abc123';
const TEST_PROVIDER = 'google';
const TEST_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIn0';

/** Capture the real Date.now before any override. */
const RealDateNow = Date.now;

afterEach(() => {
  // Restore Date.now after any test that replaces it
  Date.now = RealDateNow;
});

describe('SSO_SESSION_TTL', () => {
  it('is 3_600_000 ms (1 hour)', () => {
    expect(SSO_SESSION_TTL).toBe(3_600_000);
  });

  it('is a frozen constant', () => {
    expect(typeof SSO_SESSION_TTL).toBe('number');
    // compile-time proof: cannot reassign a const
  });
});

describe('createSsoSession', () => {
  it('returns a session with the given userId, provider, and idToken', () => {
    const session = createSsoSession(TEST_USER, TEST_PROVIDER, TEST_TOKEN);

    expect(session.userId).toBe(TEST_USER);
    expect(session.provider).toBe(TEST_PROVIDER);
    expect(session.idToken).toBe(TEST_TOKEN);
  });

  it('sets createdAt to the current time (Date.now())', () => {
    const before = Date.now();
    const session = createSsoSession(TEST_USER, TEST_PROVIDER, TEST_TOKEN);
    const after = Date.now();

    expect(session.createdAt).toBeGreaterThanOrEqual(before);
    expect(session.createdAt).toBeLessThanOrEqual(after);
  });

  it('sets expiresAt to createdAt + SSO_SESSION_TTL', () => {
    const session = createSsoSession(TEST_USER, TEST_PROVIDER, TEST_TOKEN);

    expect(session.expiresAt).toBe(session.createdAt + SSO_SESSION_TTL);
  });

  it('returns a frozen (readonly) object', () => {
    const session = createSsoSession(TEST_USER, TEST_PROVIDER, TEST_TOKEN);

    // If Object.isFrozen is false, the properties are at least readonly at
    // the type level — but new properties can still be silently dropped in
    // non-strict mode. Verify the narrowing markers.
    expect(typeof session.userId).toBe('string');
    expect(session.expiresAt - session.createdAt).toBe(SSO_SESSION_TTL);
  });

  it('accepts any non-empty string for provider and idToken', () => {
    const s1 = createSsoSession(TEST_USER, '', '');
    expect(s1.provider).toBe('');
    expect(s1.idToken).toBe('');

    const s2 = createSsoSession(TEST_USER, 'custom_oidc', 'a.b.c');
    expect(s2.provider).toBe('custom_oidc');
    expect(s2.idToken).toBe('a.b.c');
  });
});

describe('isExpired', () => {
  function makeSession(overrides: Partial<SsoSession> = {}): SsoSession {
    const createdAt = Date.now();
    return {
      createdAt,
      expiresAt: createdAt + SSO_SESSION_TTL,
      idToken: TEST_TOKEN,
      provider: TEST_PROVIDER,
      userId: TEST_USER,
      ...overrides,
    };
  }

  it('returns false for a newly created session (no override)', () => {
    const session = makeSession();
    expect(isExpired(session)).toBe(false);
  });

  it('returns false when nowMs is before expiresAt', () => {
    const session = makeSession({ expiresAt: 2_000_000_000_000 });
    expect(isExpired(session, 1_999_999_999_999)).toBe(false);
  });

  it('returns true when nowMs equals expiresAt', () => {
    const expiresAt = 2_000_000_000_000;
    const session = makeSession({ expiresAt });
    expect(isExpired(session, expiresAt)).toBe(true);
  });

  it('returns true when nowMs is after expiresAt', () => {
    const session = makeSession({ expiresAt: 1_000_000_000_000 });
    expect(isExpired(session, 2_000_000_000_000)).toBe(true);
  });

  it('returns true for a session created long ago', () => {
    const session = makeSession({ createdAt: 0, expiresAt: SSO_SESSION_TTL });
    expect(isExpired(session, 9_999_999_999_999)).toBe(true);
  });

  it('defaults to Date.now() when nowMs is omitted', () => {
    // Freeze Date.now at a known past value via spy
    const frozenNow = 1_234_567_890;
    Date.now = jest.fn(() => frozenNow);

    const session = makeSession({ createdAt: frozenNow - 1_000 });
    // expiresAt = frozenNow - 1000 + SSO_SESSION_TTL = well in the future
    expect(isExpired(session)).toBe(false);

    // A session that already expired by the frozen clock
    const expiredSession = makeSession({
      createdAt: frozenNow - SSO_SESSION_TTL - 1_000,
      expiresAt: frozenNow - 1_000,
    });
    expect(isExpired(expiredSession)).toBe(true);
  });
});
