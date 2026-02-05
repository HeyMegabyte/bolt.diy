/**
 * Auth Service Tests - TDD
 * These tests define the expected behavior of the auth service.
 * Implementation should be written to make these tests pass.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Types for testing (implementation will satisfy these interfaces)
interface AuthService {
  // Magic Link
  createMagicLink(email: string, redirectUrl?: string): Promise<MagicLinkResult>;
  verifyMagicLink(token: string): Promise<AuthResult>;

  // Phone OTP
  createPhoneOtp(phone: string): Promise<OtpResult>;
  verifyPhoneOtp(phone: string, otp: string): Promise<OtpVerifyResult>;

  // Google OAuth
  createGoogleOAuthState(redirectUrl?: string): Promise<OAuthStateResult>;
  handleGoogleOAuthCallback(code: string, state: string): Promise<AuthResult>;

  // Session Management
  getSession(sessionId: string): Promise<Session | null>;
  getUserSessions(userId: string): Promise<SessionListItem[]>;
  revokeSession(sessionId: string, userId: string): Promise<void>;
  revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void>;

  // User lookup
  getUserByEmail(email: string): Promise<User | null>;
  getUserByPhone(phone: string): Promise<User | null>;
  getUserById(userId: string): Promise<User | null>;
}

interface MagicLinkResult {
  id: string;
  token: string; // Raw token (for email)
  expiresAt: string;
}

interface OtpResult {
  id: string;
  expiresAt: string;
  // OTP is sent via SMS, not returned
}

interface OtpVerifyResult {
  verified: boolean;
  userId?: string;
  tempToken?: string; // For completing 2FA flow
}

interface OAuthStateResult {
  authUrl: string;
  state: string;
}

interface AuthResult {
  success: boolean;
  user?: User;
  session?: {
    id: string;
    token: string;
    expiresAt: string;
  };
  error?: string;
  needs2FA?: boolean;
  tempToken?: string;
}

interface User {
  id: string;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  googleId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Session {
  id: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  deviceInfo: string | null;
  lastActiveAt: string;
  expiresAt: string;
  createdAt: string;
}

interface SessionListItem {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

// Mock dependencies
const mockDb = {
  magicLinks: new Map<string, any>(),
  phoneOtps: new Map<string, any>(),
  oauthStates: new Map<string, any>(),
  users: new Map<string, any>(),
  sessions: new Map<string, any>(),

  reset() {
    this.magicLinks.clear();
    this.phoneOtps.clear();
    this.oauthStates.clear();
    this.users.clear();
    this.sessions.clear();
  },
};

const mockSmsService = {
  sendOtp: jest.fn<(phone: string, otp: string) => Promise<void>>(),
};

const mockEmailService = {
  sendMagicLink: jest.fn<(email: string, link: string) => Promise<void>>(),
};

const mockGoogleOAuth = {
  exchangeCode: jest.fn<(code: string, codeVerifier: string) => Promise<{ access_token: string }>>(),
  getUserInfo: jest.fn<(accessToken: string) => Promise<any>>(),
};

// The auth service will be injected - these tests define its contract
let authService: AuthService;

describe('AuthService', () => {
  beforeEach(() => {
    mockDb.reset();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // MAGIC LINK TESTS
  // ==========================================================================
  describe('Magic Link Authentication', () => {
    describe('createMagicLink', () => {
      it('should create a magic link with valid email', async () => {
        const result = await authService.createMagicLink('test@example.com');

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.token).toBeDefined();
        expect(result.token.length).toBeGreaterThanOrEqual(32);
        expect(result.expiresAt).toBeDefined();
        expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
      });

      it('should create a magic link with redirect URL', async () => {
        const redirectUrl = 'https://example.com/dashboard';
        const result = await authService.createMagicLink('test@example.com', redirectUrl);

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
      });

      it('should send magic link email', async () => {
        await authService.createMagicLink('test@example.com');

        expect(mockEmailService.sendMagicLink).toHaveBeenCalledTimes(1);
        expect(mockEmailService.sendMagicLink).toHaveBeenCalledWith(
          'test@example.com',
          expect.stringContaining('token='),
        );
      });

      it('should reject invalid email format', async () => {
        await expect(authService.createMagicLink('invalid-email')).rejects.toThrow();
        await expect(authService.createMagicLink('')).rejects.toThrow();
        await expect(authService.createMagicLink('test@')).rejects.toThrow();
      });

      it('should reject malicious email with script injection', async () => {
        await expect(
          authService.createMagicLink('<script>alert(1)</script>@example.com'),
        ).rejects.toThrow();
      });

      it('should set expiry to 24 hours by default', async () => {
        const result = await authService.createMagicLink('test@example.com');
        const expiresAt = new Date(result.expiresAt).getTime();
        const expectedExpiry = Date.now() + 24 * 60 * 60 * 1000;

        // Allow 1 minute tolerance
        expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(60000);
      });

      it('should hash the token before storage', async () => {
        const result = await authService.createMagicLink('test@example.com');

        // The stored token should be hashed, not the raw token
        const stored = mockDb.magicLinks.get(result.id);
        expect(stored.tokenHash).toBeDefined();
        expect(stored.tokenHash).not.toBe(result.token);
      });

      it('should rate limit magic link creation (max 5 per hour per email)', async () => {
        const email = 'ratelimit@example.com';

        // First 5 should succeed
        for (let i = 0; i < 5; i++) {
          await authService.createMagicLink(email);
        }

        // 6th should fail
        await expect(authService.createMagicLink(email)).rejects.toThrow(/rate limit/i);
      });

      it('should invalidate previous magic links for same email', async () => {
        const email = 'test@example.com';

        const first = await authService.createMagicLink(email);
        const second = await authService.createMagicLink(email);

        // First link should no longer be valid
        const firstResult = await authService.verifyMagicLink(first.token);
        expect(firstResult.success).toBe(false);
        expect(firstResult.error).toMatch(/expired|invalid/i);

        // Second link should still be valid
        const secondResult = await authService.verifyMagicLink(second.token);
        expect(secondResult.success).toBe(true);
      });
    });

    describe('verifyMagicLink', () => {
      it('should verify valid magic link and create session', async () => {
        const { token } = await authService.createMagicLink('test@example.com');

        const result = await authService.verifyMagicLink(token);

        expect(result.success).toBe(true);
        expect(result.user).toBeDefined();
        expect(result.user?.email).toBe('test@example.com');
        expect(result.user?.emailVerified).toBe(true);
        expect(result.session).toBeDefined();
        expect(result.session?.token).toBeDefined();
      });

      it('should create new user if not exists', async () => {
        const { token } = await authService.createMagicLink('newuser@example.com');

        const result = await authService.verifyMagicLink(token);

        expect(result.success).toBe(true);
        expect(result.user?.id).toBeDefined();
        expect(result.user?.email).toBe('newuser@example.com');
      });

      it('should return existing user if exists', async () => {
        // Create existing user
        const existingUser = {
          id: 'existing-user-id',
          email: 'existing@example.com',
          emailVerified: true,
        };
        mockDb.users.set(existingUser.id, existingUser);

        const { token } = await authService.createMagicLink('existing@example.com');
        const result = await authService.verifyMagicLink(token);

        expect(result.success).toBe(true);
        expect(result.user?.id).toBe('existing-user-id');
      });

      it('should reject expired magic link', async () => {
        const { token, id } = await authService.createMagicLink('test@example.com');

        // Manually expire the link
        const stored = mockDb.magicLinks.get(id);
        stored.expiresAt = new Date(Date.now() - 1000).toISOString();
        mockDb.magicLinks.set(id, stored);

        const result = await authService.verifyMagicLink(token);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/expired/i);
      });

      it('should reject already used magic link', async () => {
        const { token } = await authService.createMagicLink('test@example.com');

        // First use
        const first = await authService.verifyMagicLink(token);
        expect(first.success).toBe(true);

        // Second use should fail
        const second = await authService.verifyMagicLink(token);
        expect(second.success).toBe(false);
        expect(second.error).toMatch(/already used|invalid/i);
      });

      it('should reject invalid token format', async () => {
        const result = await authService.verifyMagicLink('invalid-token');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid/i);
      });

      it('should reject token with wrong hash', async () => {
        await authService.createMagicLink('test@example.com');

        // Try with a made-up token
        const result = await authService.verifyMagicLink('a'.repeat(64));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid/i);
      });

      it('should require 2FA if user has phone verified', async () => {
        // Create user with verified phone
        const existingUser = {
          id: 'user-with-phone',
          email: 'phone@example.com',
          phone: '+14155551234',
          emailVerified: true,
          phoneVerified: true,
        };
        mockDb.users.set(existingUser.id, existingUser);

        const { token } = await authService.createMagicLink('phone@example.com');
        const result = await authService.verifyMagicLink(token);

        expect(result.success).toBe(false);
        expect(result.needs2FA).toBe(true);
        expect(result.tempToken).toBeDefined();
      });

      it('should handle SQL injection in token', async () => {
        const maliciousToken = "'; DROP TABLE users; --";

        const result = await authService.verifyMagicLink(maliciousToken);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid/i);
      });
    });
  });

  // ==========================================================================
  // PHONE OTP TESTS
  // ==========================================================================
  describe('Phone OTP Authentication', () => {
    describe('createPhoneOtp', () => {
      it('should create OTP for valid phone number', async () => {
        const result = await authService.createPhoneOtp('+14155551234');

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.expiresAt).toBeDefined();
      });

      it('should send OTP via SMS', async () => {
        await authService.createPhoneOtp('+14155551234');

        expect(mockSmsService.sendOtp).toHaveBeenCalledTimes(1);
        expect(mockSmsService.sendOtp).toHaveBeenCalledWith(
          '+14155551234',
          expect.stringMatching(/^\d{6}$/),
        );
      });

      it('should generate 6-digit OTP', async () => {
        await authService.createPhoneOtp('+14155551234');

        const [, otp] = mockSmsService.sendOtp.mock.calls[0];
        expect(otp).toMatch(/^\d{6}$/);
        expect(parseInt(otp, 10)).toBeGreaterThanOrEqual(0);
        expect(parseInt(otp, 10)).toBeLessThanOrEqual(999999);
      });

      it('should reject invalid phone format', async () => {
        await expect(authService.createPhoneOtp('invalid')).rejects.toThrow();
        await expect(authService.createPhoneOtp('123')).rejects.toThrow();
        await expect(authService.createPhoneOtp('')).rejects.toThrow();
      });

      it('should normalize phone number format', async () => {
        // Different formats should be normalized
        await authService.createPhoneOtp('(415) 555-1234');

        expect(mockSmsService.sendOtp).toHaveBeenCalledWith(
          '+14155551234',
          expect.any(String),
        );
      });

      it('should set expiry to 5 minutes', async () => {
        const result = await authService.createPhoneOtp('+14155551234');
        const expiresAt = new Date(result.expiresAt).getTime();
        const expectedExpiry = Date.now() + 5 * 60 * 1000;

        // Allow 10 second tolerance
        expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(10000);
      });

      it('should hash OTP before storage', async () => {
        const result = await authService.createPhoneOtp('+14155551234');

        const stored = mockDb.phoneOtps.get(result.id);
        expect(stored.otpHash).toBeDefined();

        // The hash should not be the raw OTP
        const [, rawOtp] = mockSmsService.sendOtp.mock.calls[0];
        expect(stored.otpHash).not.toBe(rawOtp);
      });

      it('should rate limit OTP creation (max 3 per 15 minutes per phone)', async () => {
        const phone = '+14155559999';

        // First 3 should succeed
        for (let i = 0; i < 3; i++) {
          await authService.createPhoneOtp(phone);
        }

        // 4th should fail
        await expect(authService.createPhoneOtp(phone)).rejects.toThrow(/rate limit/i);
      });

      it('should invalidate previous OTPs for same phone', async () => {
        const phone = '+14155551234';

        await authService.createPhoneOtp(phone);
        const [, firstOtp] = mockSmsService.sendOtp.mock.calls[0];

        await authService.createPhoneOtp(phone);
        const [, secondOtp] = mockSmsService.sendOtp.mock.calls[1];

        // First OTP should be invalid
        const firstResult = await authService.verifyPhoneOtp(phone, firstOtp);
        expect(firstResult.verified).toBe(false);

        // Second OTP should be valid
        const secondResult = await authService.verifyPhoneOtp(phone, secondOtp);
        expect(secondResult.verified).toBe(true);
      });
    });

    describe('verifyPhoneOtp', () => {
      it('should verify correct OTP', async () => {
        await authService.createPhoneOtp('+14155551234');
        const [, otp] = mockSmsService.sendOtp.mock.calls[0];

        const result = await authService.verifyPhoneOtp('+14155551234', otp);

        expect(result.verified).toBe(true);
      });

      it('should reject incorrect OTP', async () => {
        await authService.createPhoneOtp('+14155551234');

        const result = await authService.verifyPhoneOtp('+14155551234', '000000');

        expect(result.verified).toBe(false);
      });

      it('should reject expired OTP', async () => {
        const { id } = await authService.createPhoneOtp('+14155551234');
        const [, otp] = mockSmsService.sendOtp.mock.calls[0];

        // Manually expire
        const stored = mockDb.phoneOtps.get(id);
        stored.expiresAt = new Date(Date.now() - 1000).toISOString();
        mockDb.phoneOtps.set(id, stored);

        const result = await authService.verifyPhoneOtp('+14155551234', otp);

        expect(result.verified).toBe(false);
      });

      it('should track attempts and lock after 3 failures', async () => {
        await authService.createPhoneOtp('+14155551234');

        // 3 wrong attempts
        for (let i = 0; i < 3; i++) {
          const result = await authService.verifyPhoneOtp('+14155551234', '000000');
          expect(result.verified).toBe(false);
        }

        // Now even correct OTP should fail
        const [, correctOtp] = mockSmsService.sendOtp.mock.calls[0];
        const result = await authService.verifyPhoneOtp('+14155551234', correctOtp);

        expect(result.verified).toBe(false);
      });

      it('should not reveal if phone exists', async () => {
        // For a phone that never requested OTP
        const result = await authService.verifyPhoneOtp('+19995551234', '123456');

        // Error message should be generic, not revealing phone doesn't exist
        expect(result.verified).toBe(false);
      });

      it('should mark OTP as used after successful verification', async () => {
        await authService.createPhoneOtp('+14155551234');
        const [, otp] = mockSmsService.sendOtp.mock.calls[0];

        // First verification
        const first = await authService.verifyPhoneOtp('+14155551234', otp);
        expect(first.verified).toBe(true);

        // Second verification with same OTP should fail
        const second = await authService.verifyPhoneOtp('+14155551234', otp);
        expect(second.verified).toBe(false);
      });

      it('should handle non-numeric OTP gracefully', async () => {
        await authService.createPhoneOtp('+14155551234');

        const result = await authService.verifyPhoneOtp('+14155551234', 'abcdef');

        expect(result.verified).toBe(false);
      });
    });
  });

  // ==========================================================================
  // GOOGLE OAUTH TESTS
  // ==========================================================================
  describe('Google OAuth Authentication', () => {
    describe('createGoogleOAuthState', () => {
      it('should create OAuth state and return auth URL', async () => {
        const result = await authService.createGoogleOAuthState();

        expect(result.authUrl).toBeDefined();
        expect(result.authUrl).toContain('accounts.google.com');
        expect(result.authUrl).toContain('response_type=code');
        expect(result.state).toBeDefined();
      });

      it('should include redirect URL in state', async () => {
        const redirectUrl = 'https://example.com/dashboard';
        const result = await authService.createGoogleOAuthState(redirectUrl);

        expect(result.authUrl).toBeDefined();
        expect(result.state).toBeDefined();
      });

      it('should use PKCE flow (code_challenge)', async () => {
        const result = await authService.createGoogleOAuthState();

        expect(result.authUrl).toContain('code_challenge=');
        expect(result.authUrl).toContain('code_challenge_method=S256');
      });

      it('should store code verifier for later use', async () => {
        const result = await authService.createGoogleOAuthState();

        // State should be stored with code verifier
        const stored = mockDb.oauthStates.get(result.state);
        expect(stored).toBeDefined();
        expect(stored.codeVerifier).toBeDefined();
      });

      it('should set state expiry to 10 minutes', async () => {
        const result = await authService.createGoogleOAuthState();

        const stored = mockDb.oauthStates.get(result.state);
        const expiresAt = new Date(stored.expiresAt).getTime();
        const expectedExpiry = Date.now() + 10 * 60 * 1000;

        expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(10000);
      });
    });

    describe('handleGoogleOAuthCallback', () => {
      beforeEach(() => {
        // Setup mock Google responses
        mockGoogleOAuth.exchangeCode.mockResolvedValue({ access_token: 'test-access-token' });
        mockGoogleOAuth.getUserInfo.mockResolvedValue({
          sub: 'google-user-id-123',
          email: 'googleuser@gmail.com',
          email_verified: true,
          name: 'Test User',
          picture: 'https://example.com/avatar.jpg',
        });
      });

      it('should exchange code for tokens and create session', async () => {
        const { state } = await authService.createGoogleOAuthState();

        const result = await authService.handleGoogleOAuthCallback('auth-code', state);

        expect(result.success).toBe(true);
        expect(result.user).toBeDefined();
        expect(result.session).toBeDefined();
      });

      it('should create new user from Google info', async () => {
        const { state } = await authService.createGoogleOAuthState();

        const result = await authService.handleGoogleOAuthCallback('auth-code', state);

        expect(result.user?.email).toBe('googleuser@gmail.com');
        expect(result.user?.googleId).toBe('google-user-id-123');
        expect(result.user?.displayName).toBe('Test User');
        expect(result.user?.avatarUrl).toBe('https://example.com/avatar.jpg');
        expect(result.user?.emailVerified).toBe(true);
      });

      it('should link to existing user by email', async () => {
        // Create existing user
        const existingUser = {
          id: 'existing-google-user',
          email: 'googleuser@gmail.com',
          googleId: null,
        };
        mockDb.users.set(existingUser.id, existingUser);

        const { state } = await authService.createGoogleOAuthState();
        const result = await authService.handleGoogleOAuthCallback('auth-code', state);

        expect(result.user?.id).toBe('existing-google-user');
        expect(result.user?.googleId).toBe('google-user-id-123');
      });

      it('should reject invalid state', async () => {
        const result = await authService.handleGoogleOAuthCallback('auth-code', 'invalid-state');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid state/i);
      });

      it('should reject expired state', async () => {
        const { state } = await authService.createGoogleOAuthState();

        // Expire the state
        const stored = mockDb.oauthStates.get(state);
        stored.expiresAt = new Date(Date.now() - 1000).toISOString();
        mockDb.oauthStates.set(state, stored);

        const result = await authService.handleGoogleOAuthCallback('auth-code', state);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/expired/i);
      });

      it('should reject already used state', async () => {
        const { state } = await authService.createGoogleOAuthState();

        // First use
        await authService.handleGoogleOAuthCallback('auth-code', state);

        // Second use
        const result = await authService.handleGoogleOAuthCallback('auth-code', state);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already used|invalid/i);
      });

      it('should handle Google API error gracefully', async () => {
        mockGoogleOAuth.exchangeCode.mockRejectedValue(new Error('Google API error'));

        const { state } = await authService.createGoogleOAuthState();
        const result = await authService.handleGoogleOAuthCallback('auth-code', state);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/authentication failed/i);
      });

      it('should reject unverified email from Google', async () => {
        mockGoogleOAuth.getUserInfo.mockResolvedValue({
          sub: 'google-user-id-123',
          email: 'unverified@gmail.com',
          email_verified: false,
        });

        const { state } = await authService.createGoogleOAuthState();
        const result = await authService.handleGoogleOAuthCallback('auth-code', state);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/email not verified/i);
      });

      it('should require 2FA if user has phone verified', async () => {
        // Create existing user with verified phone
        const existingUser = {
          id: 'user-with-phone-google',
          email: 'googleuser@gmail.com',
          phone: '+14155551234',
          emailVerified: true,
          phoneVerified: true,
        };
        mockDb.users.set(existingUser.id, existingUser);

        const { state } = await authService.createGoogleOAuthState();
        const result = await authService.handleGoogleOAuthCallback('auth-code', state);

        expect(result.success).toBe(false);
        expect(result.needs2FA).toBe(true);
        expect(result.tempToken).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // SESSION MANAGEMENT TESTS
  // ==========================================================================
  describe('Session Management', () => {
    let testUserId: string;
    let testSessionId: string;

    beforeEach(async () => {
      // Create a test user and session
      const { token } = await authService.createMagicLink('session-test@example.com');
      const result = await authService.verifyMagicLink(token);
      testUserId = result.user!.id;
      testSessionId = result.session!.id;
    });

    describe('getSession', () => {
      it('should return session by ID', async () => {
        const session = await authService.getSession(testSessionId);

        expect(session).toBeDefined();
        expect(session?.id).toBe(testSessionId);
        expect(session?.userId).toBe(testUserId);
      });

      it('should return null for non-existent session', async () => {
        const session = await authService.getSession('non-existent-id');

        expect(session).toBeNull();
      });

      it('should return null for revoked session', async () => {
        await authService.revokeSession(testSessionId, testUserId);

        const session = await authService.getSession(testSessionId);

        expect(session).toBeNull();
      });

      it('should return null for expired session', async () => {
        // Expire the session
        const stored = mockDb.sessions.get(testSessionId);
        stored.expiresAt = new Date(Date.now() - 1000).toISOString();
        mockDb.sessions.set(testSessionId, stored);

        const session = await authService.getSession(testSessionId);

        expect(session).toBeNull();
      });
    });

    describe('getUserSessions', () => {
      it('should return all active sessions for user', async () => {
        const sessions = await authService.getUserSessions(testUserId);

        expect(sessions).toBeInstanceOf(Array);
        expect(sessions.length).toBeGreaterThanOrEqual(1);
        expect(sessions[0].id).toBe(testSessionId);
      });

      it('should not include revoked sessions', async () => {
        await authService.revokeSession(testSessionId, testUserId);

        const sessions = await authService.getUserSessions(testUserId);

        expect(sessions.find((s) => s.id === testSessionId)).toBeUndefined();
      });

      it('should mark current session', async () => {
        // This would need the current session ID passed in context
        const sessions = await authService.getUserSessions(testUserId);

        expect(sessions.some((s) => s.isCurrent !== undefined)).toBe(true);
      });

      it('should return empty array for user with no sessions', async () => {
        const sessions = await authService.getUserSessions('non-existent-user');

        expect(sessions).toEqual([]);
      });
    });

    describe('revokeSession', () => {
      it('should revoke session successfully', async () => {
        await authService.revokeSession(testSessionId, testUserId);

        const session = await authService.getSession(testSessionId);
        expect(session).toBeNull();
      });

      it('should only allow user to revoke their own sessions', async () => {
        await expect(
          authService.revokeSession(testSessionId, 'different-user-id'),
        ).rejects.toThrow(/unauthorized|forbidden/i);
      });

      it('should be idempotent (revoking twice does not error)', async () => {
        await authService.revokeSession(testSessionId, testUserId);
        await expect(
          authService.revokeSession(testSessionId, testUserId),
        ).resolves.not.toThrow();
      });
    });

    describe('revokeAllSessions', () => {
      it('should revoke all sessions for user', async () => {
        // Create another session
        const { token } = await authService.createMagicLink('session-test@example.com');
        await authService.verifyMagicLink(token);

        await authService.revokeAllSessions(testUserId);

        const sessions = await authService.getUserSessions(testUserId);
        expect(sessions.length).toBe(0);
      });

      it('should keep specified session when exceptSessionId provided', async () => {
        // Create another session
        const { token } = await authService.createMagicLink('session-test@example.com');
        const result = await authService.verifyMagicLink(token);
        const newSessionId = result.session!.id;

        await authService.revokeAllSessions(testUserId, newSessionId);

        const sessions = await authService.getUserSessions(testUserId);
        expect(sessions.length).toBe(1);
        expect(sessions[0].id).toBe(newSessionId);
      });
    });
  });

  // ==========================================================================
  // USER LOOKUP TESTS
  // ==========================================================================
  describe('User Lookup', () => {
    beforeEach(async () => {
      // Create test user
      const { token } = await authService.createMagicLink('lookup@example.com');
      await authService.verifyMagicLink(token);
    });

    describe('getUserByEmail', () => {
      it('should find user by email', async () => {
        const user = await authService.getUserByEmail('lookup@example.com');

        expect(user).toBeDefined();
        expect(user?.email).toBe('lookup@example.com');
      });

      it('should return null for non-existent email', async () => {
        const user = await authService.getUserByEmail('nonexistent@example.com');

        expect(user).toBeNull();
      });

      it('should be case-insensitive', async () => {
        const user = await authService.getUserByEmail('LOOKUP@EXAMPLE.COM');

        expect(user).toBeDefined();
        expect(user?.email).toBe('lookup@example.com');
      });
    });

    describe('getUserByPhone', () => {
      it('should find user by phone', async () => {
        // Create user with phone
        await authService.createPhoneOtp('+14155551234');
        const [, otp] = mockSmsService.sendOtp.mock.calls[0];
        await authService.verifyPhoneOtp('+14155551234', otp);

        const user = await authService.getUserByPhone('+14155551234');

        expect(user).toBeDefined();
        expect(user?.phone).toBe('+14155551234');
      });

      it('should return null for non-existent phone', async () => {
        const user = await authService.getUserByPhone('+19999999999');

        expect(user).toBeNull();
      });

      it('should normalize phone format', async () => {
        await authService.createPhoneOtp('+14155551234');
        const [, otp] = mockSmsService.sendOtp.mock.calls[0];
        await authService.verifyPhoneOtp('+14155551234', otp);

        const user = await authService.getUserByPhone('(415) 555-1234');

        expect(user).toBeDefined();
      });
    });

    describe('getUserById', () => {
      it('should find user by ID', async () => {
        const userByEmail = await authService.getUserByEmail('lookup@example.com');
        const user = await authService.getUserById(userByEmail!.id);

        expect(user).toBeDefined();
        expect(user?.id).toBe(userByEmail!.id);
      });

      it('should return null for non-existent ID', async () => {
        const user = await authService.getUserById('non-existent-id');

        expect(user).toBeNull();
      });
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================
  describe('Security', () => {
    it('should not leak timing information on invalid tokens', async () => {
      // Both calls should take similar time (constant-time comparison)
      const start1 = performance.now();
      await authService.verifyMagicLink('a'.repeat(64));
      const time1 = performance.now() - start1;

      const start2 = performance.now();
      await authService.verifyMagicLink('b'.repeat(64));
      const time2 = performance.now() - start2;

      // Times should be within 50ms of each other (allowing for variance)
      expect(Math.abs(time1 - time2)).toBeLessThan(50);
    });

    it('should use secure random for token generation', async () => {
      const results = await Promise.all([
        authService.createMagicLink('sec1@example.com'),
        authService.createMagicLink('sec2@example.com'),
        authService.createMagicLink('sec3@example.com'),
      ]);

      const tokens = results.map((r) => r.token);
      const uniqueTokens = new Set(tokens);

      expect(uniqueTokens.size).toBe(3);
    });

    it('should not expose internal errors in responses', async () => {
      // Force an internal error
      mockDb.magicLinks.set = () => {
        throw new Error('Database connection failed');
      };

      try {
        await authService.createMagicLink('error@example.com');
      } catch (error: any) {
        // Error should be generic, not exposing database details
        expect(error.message).not.toContain('Database');
        expect(error.message).not.toContain('connection');
      }
    });
  });
});
