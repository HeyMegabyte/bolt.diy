/**
 * Auth Service Implementation
 * Handles magic links, phone OTP, Google OAuth, and session management
 */
import { z } from 'zod';
import {
  generateId,
  generateToken,
  generateOtp,
  sha256,
  nowISO,
  hoursFromNow,
  minutesFromNow,
  isExpired,
  emailSchema,
  phoneSchema,
  normalizePhone,
  sanitizeText,
  AUTH,
} from '@project-sites/shared';

// =============================================================================
// TYPES
// =============================================================================

export interface AuthServiceDeps {
  db: Database;
  kv: KVNamespace;
  emailService: EmailService;
  smsService: SmsService;
  googleClientId: string;
  googleClientSecret: string;
  baseUrl: string;
}

interface Database {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ rowsAffected: number }>;
}

interface EmailService {
  sendMagicLink(email: string, link: string): Promise<void>;
}

interface SmsService {
  sendOtp(phone: string, otp: string): Promise<void>;
}

export interface User {
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

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  ipAddress: string | null;
  userAgent: string | null;
  deviceInfo: string | null;
  lastActiveAt: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface AuthResult {
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

// =============================================================================
// AUTH SERVICE CLASS
// =============================================================================

export class AuthService {
  private db: Database;
  private kv: KVNamespace;
  private emailService: EmailService;
  private smsService: SmsService;
  private googleClientId: string;
  private googleClientSecret: string;
  private baseUrl: string;

  constructor(deps: AuthServiceDeps) {
    this.db = deps.db;
    this.kv = deps.kv;
    this.emailService = deps.emailService;
    this.smsService = deps.smsService;
    this.googleClientId = deps.googleClientId;
    this.googleClientSecret = deps.googleClientSecret;
    this.baseUrl = deps.baseUrl;
  }

  // ===========================================================================
  // MAGIC LINK
  // ===========================================================================

  async createMagicLink(email: string, redirectUrl?: string): Promise<{
    id: string;
    token: string;
    expiresAt: string;
  }> {
    // Validate email
    const validatedEmail = emailSchema.parse(email.toLowerCase().trim());

    // Check for script injection
    if (/<script|javascript:|data:/i.test(validatedEmail)) {
      throw new Error('Invalid email format');
    }

    // Rate limit check (max 5 per hour per email)
    const rateLimitKey = `ratelimit:magiclink:${validatedEmail}`;
    const attempts = parseInt((await this.kv.get(rateLimitKey)) ?? '0', 10);

    if (attempts >= 5) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    // Increment rate limit counter
    await this.kv.put(rateLimitKey, String(attempts + 1), {
      expirationTtl: 3600, // 1 hour
    });

    // Invalidate previous magic links for this email
    await this.db.execute(
      `UPDATE magic_links SET used_at = $1 WHERE email = $2 AND used_at IS NULL`,
      [nowISO(), validatedEmail],
    );

    // Generate token
    const id = generateId();
    const token = generateToken(32);
    const tokenHash = await sha256(token);
    const expiresAt = hoursFromNow(AUTH.MAGIC_LINK_EXPIRY_HOURS);

    // Store magic link
    await this.db.execute(
      `INSERT INTO magic_links (id, email, token_hash, redirect_url, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, validatedEmail, tokenHash, redirectUrl ?? null, expiresAt, nowISO()],
    );

    // Send email
    const magicLink = `${this.baseUrl}/auth/verify?token=${token}`;
    await this.emailService.sendMagicLink(validatedEmail, magicLink);

    return { id, token, expiresAt };
  }

  async verifyMagicLink(token: string): Promise<AuthResult> {
    // Validate token format
    if (!token || token.length < 32 || token.length > 128) {
      return { success: false, error: 'Invalid token' };
    }

    // Hash token for lookup
    const tokenHash = await sha256(token);

    // Find magic link
    const links = await this.db.query<{
      id: string;
      email: string;
      redirect_url: string | null;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT id, email, redirect_url, expires_at, used_at
       FROM magic_links WHERE token_hash = $1`,
      [tokenHash],
    );

    const link = links[0];

    if (!link) {
      return { success: false, error: 'Invalid token' };
    }

    if (link.used_at) {
      return { success: false, error: 'Token already used' };
    }

    if (isExpired(link.expires_at)) {
      return { success: false, error: 'Token expired' };
    }

    // Mark as used
    await this.db.execute(
      `UPDATE magic_links SET used_at = $1 WHERE id = $2`,
      [nowISO(), link.id],
    );

    // Get or create user
    let user = await this.getUserByEmail(link.email);

    if (!user) {
      user = await this.createUser({ email: link.email, emailVerified: true });
    } else if (!user.emailVerified) {
      await this.db.execute(
        `UPDATE users SET email_verified = true, updated_at = $1 WHERE id = $2`,
        [nowISO(), user.id],
      );
      user.emailVerified = true;
    }

    // Check if 2FA required
    if (user.phoneVerified) {
      const tempToken = generateToken(32);
      await this.kv.put(`2fa:${tempToken}`, JSON.stringify({
        userId: user.id,
        method: 'sms',
        expiresAt: minutesFromNow(10),
      }), { expirationTtl: 600 });

      return {
        success: false,
        needs2FA: true,
        tempToken,
      };
    }

    // Create session
    const session = await this.createSession(user.id);

    return {
      success: true,
      user,
      session,
    };
  }

  // ===========================================================================
  // PHONE OTP
  // ===========================================================================

  async createPhoneOtp(phone: string): Promise<{ id: string; expiresAt: string }> {
    // Validate and normalize phone
    const normalizedPhone = normalizePhone(phone);
    phoneSchema.parse(normalizedPhone);

    // Rate limit check (max 3 per 15 minutes per phone)
    const rateLimitKey = `ratelimit:otp:${normalizedPhone}`;
    const attempts = parseInt((await this.kv.get(rateLimitKey)) ?? '0', 10);

    if (attempts >= 3) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    await this.kv.put(rateLimitKey, String(attempts + 1), {
      expirationTtl: 900, // 15 minutes
    });

    // Invalidate previous OTPs
    await this.db.execute(
      `UPDATE phone_otps SET verified_at = $1 WHERE phone = $2 AND verified_at IS NULL`,
      [nowISO(), normalizedPhone],
    );

    // Generate OTP
    const id = generateId();
    const otp = generateOtp();
    const otpHash = await sha256(otp);
    const expiresAt = minutesFromNow(AUTH.OTP_EXPIRY_MINUTES);

    // Store OTP
    await this.db.execute(
      `INSERT INTO phone_otps (id, phone, otp_hash, attempts, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, normalizedPhone, otpHash, 0, expiresAt, nowISO()],
    );

    // Send SMS
    await this.smsService.sendOtp(normalizedPhone, otp);

    return { id, expiresAt };
  }

  async verifyPhoneOtp(phone: string, otp: string): Promise<{
    verified: boolean;
    userId?: string;
    tempToken?: string;
  }> {
    const normalizedPhone = normalizePhone(phone);

    // Validate OTP format
    if (!/^\d{6}$/.test(otp)) {
      return { verified: false };
    }

    // Find latest OTP for this phone
    const otps = await this.db.query<{
      id: string;
      otp_hash: string;
      attempts: number;
      expires_at: string;
      verified_at: string | null;
    }>(
      `SELECT id, otp_hash, attempts, expires_at, verified_at
       FROM phone_otps WHERE phone = $1
       ORDER BY created_at DESC LIMIT 1`,
      [normalizedPhone],
    );

    const otpRecord = otps[0];

    if (!otpRecord) {
      return { verified: false };
    }

    if (otpRecord.verified_at) {
      return { verified: false };
    }

    if (isExpired(otpRecord.expires_at)) {
      return { verified: false };
    }

    if (otpRecord.attempts >= AUTH.OTP_MAX_ATTEMPTS) {
      return { verified: false };
    }

    // Verify OTP
    const otpHash = await sha256(otp);
    const isValid = otpHash === otpRecord.otp_hash;

    if (!isValid) {
      // Increment attempts
      await this.db.execute(
        `UPDATE phone_otps SET attempts = attempts + 1 WHERE id = $1`,
        [otpRecord.id],
      );
      return { verified: false };
    }

    // Mark as verified
    await this.db.execute(
      `UPDATE phone_otps SET verified_at = $1 WHERE id = $2`,
      [nowISO(), otpRecord.id],
    );

    // Get or create user by phone
    let user = await this.getUserByPhone(normalizedPhone);

    if (!user) {
      user = await this.createUser({ phone: normalizedPhone, phoneVerified: true });
    } else if (!user.phoneVerified) {
      await this.db.execute(
        `UPDATE users SET phone_verified = true, updated_at = $1 WHERE id = $2`,
        [nowISO(), user.id],
      );
    }

    return { verified: true, userId: user.id };
  }

  // ===========================================================================
  // GOOGLE OAUTH
  // ===========================================================================

  async createGoogleOAuthState(redirectUrl?: string): Promise<{
    authUrl: string;
    state: string;
  }> {
    const state = generateToken(32);
    const codeVerifier = generateToken(32);
    const codeChallenge = await sha256(codeVerifier);

    // Store state
    await this.db.execute(
      `INSERT INTO oauth_states (id, state_token, redirect_url, code_verifier, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [generateId(), state, redirectUrl ?? null, codeVerifier, minutesFromNow(10), nowISO()],
    );

    const params = new URLSearchParams({
      client_id: this.googleClientId,
      redirect_uri: `${this.baseUrl}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return { authUrl, state };
  }

  async handleGoogleOAuthCallback(code: string, state: string): Promise<AuthResult> {
    // Find state record
    const states = await this.db.query<{
      id: string;
      redirect_url: string | null;
      code_verifier: string;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT id, redirect_url, code_verifier, expires_at, used_at
       FROM oauth_states WHERE state_token = $1`,
      [state],
    );

    const stateRecord = states[0];

    if (!stateRecord) {
      return { success: false, error: 'Invalid state' };
    }

    if (stateRecord.used_at) {
      return { success: false, error: 'State already used' };
    }

    if (isExpired(stateRecord.expires_at)) {
      return { success: false, error: 'State expired' };
    }

    // Mark as used
    await this.db.execute(
      `UPDATE oauth_states SET used_at = $1 WHERE id = $2`,
      [nowISO(), stateRecord.id],
    );

    // Exchange code for tokens
    let tokens: { access_token: string };
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.googleClientId,
          client_secret: this.googleClientSecret,
          redirect_uri: `${this.baseUrl}/api/auth/google/callback`,
          grant_type: 'authorization_code',
          code_verifier: stateRecord.code_verifier,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Token exchange failed');
      }

      tokens = await tokenResponse.json();
    } catch {
      return { success: false, error: 'Authentication failed' };
    }

    // Get user info
    let userInfo: {
      sub: string;
      email: string;
      email_verified: boolean;
      name?: string;
      picture?: string;
    };

    try {
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userResponse.ok) {
        throw new Error('Failed to get user info');
      }

      userInfo = await userResponse.json();
    } catch {
      return { success: false, error: 'Authentication failed' };
    }

    // Require verified email
    if (!userInfo.email_verified) {
      return { success: false, error: 'Email not verified with Google' };
    }

    // Get or create user
    let user = await this.getUserByEmail(userInfo.email);

    if (!user) {
      user = await this.createUser({
        email: userInfo.email,
        emailVerified: true,
        googleId: userInfo.sub,
        displayName: userInfo.name ?? null,
        avatarUrl: userInfo.picture ?? null,
      });
    } else {
      // Link Google account if not already linked
      if (!user.googleId) {
        await this.db.execute(
          `UPDATE users SET google_id = $1, display_name = COALESCE(display_name, $2),
           avatar_url = COALESCE(avatar_url, $3), updated_at = $4 WHERE id = $5`,
          [userInfo.sub, userInfo.name ?? null, userInfo.picture ?? null, nowISO(), user.id],
        );
        user.googleId = userInfo.sub;
      }
    }

    // Check if 2FA required
    if (user.phoneVerified) {
      const tempToken = generateToken(32);
      await this.kv.put(`2fa:${tempToken}`, JSON.stringify({
        userId: user.id,
        method: 'sms',
        expiresAt: minutesFromNow(10),
      }), { expirationTtl: 600 });

      return {
        success: false,
        needs2FA: true,
        tempToken,
      };
    }

    // Create session
    const session = await this.createSession(user.id);

    return {
      success: true,
      user,
      session,
    };
  }

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  async createSession(userId: string, context?: {
    ipAddress?: string;
    userAgent?: string;
    deviceInfo?: string;
  }): Promise<{ id: string; token: string; expiresAt: string }> {
    const id = generateId();
    const token = generateToken(32);
    const tokenHash = await sha256(token);
    const expiresAt = hoursFromNow(AUTH.SESSION_EXPIRY_HOURS);

    await this.db.execute(
      `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, device_info,
       last_active_at, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        userId,
        tokenHash,
        context?.ipAddress ?? null,
        context?.userAgent ?? null,
        context?.deviceInfo ?? null,
        nowISO(),
        expiresAt,
        nowISO(),
      ],
    );

    return { id, token, expiresAt };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const sessions = await this.db.query<Session>(
      `SELECT id, user_id as "userId", token_hash as "tokenHash", ip_address as "ipAddress",
       user_agent as "userAgent", device_info as "deviceInfo", last_active_at as "lastActiveAt",
       expires_at as "expiresAt", created_at as "createdAt", revoked_at as "revokedAt"
       FROM sessions WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );

    const session = sessions[0];

    if (!session || isExpired(session.expiresAt)) {
      return null;
    }

    return session;
  }

  async getUserSessions(userId: string): Promise<Array<{
    id: string;
    deviceInfo: string | null;
    ipAddress: string | null;
    lastActiveAt: string;
    createdAt: string;
    isCurrent: boolean;
  }>> {
    const sessions = await this.db.query<{
      id: string;
      device_info: string | null;
      ip_address: string | null;
      last_active_at: string;
      created_at: string;
    }>(
      `SELECT id, device_info, ip_address, last_active_at, created_at
       FROM sessions WHERE user_id = $1 AND revoked_at IS NULL
       AND expires_at > $2 ORDER BY last_active_at DESC`,
      [userId, nowISO()],
    );

    return sessions.map((s) => ({
      id: s.id,
      deviceInfo: s.device_info,
      ipAddress: s.ip_address,
      lastActiveAt: s.last_active_at,
      createdAt: s.created_at,
      isCurrent: false, // Would be set based on current request context
    }));
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    // Verify session belongs to user
    const sessions = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM sessions WHERE id = $1`,
      [sessionId],
    );

    const session = sessions[0];

    if (session && session.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    await this.db.execute(
      `UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND user_id = $3`,
      [nowISO(), sessionId, userId],
    );
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
    if (exceptSessionId) {
      await this.db.execute(
        `UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND id != $3 AND revoked_at IS NULL`,
        [nowISO(), userId, exceptSessionId],
      );
    } else {
      await this.db.execute(
        `UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`,
        [nowISO(), userId],
      );
    }
  }

  // ===========================================================================
  // USER MANAGEMENT
  // ===========================================================================

  async getUserByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.toLowerCase().trim();
    const users = await this.db.query<User>(
      `SELECT id, email, phone, email_verified as "emailVerified",
       phone_verified as "phoneVerified", google_id as "googleId",
       display_name as "displayName", avatar_url as "avatarUrl",
       created_at as "createdAt", updated_at as "updatedAt"
       FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL`,
      [normalizedEmail],
    );
    return users[0] ?? null;
  }

  async getUserByPhone(phone: string): Promise<User | null> {
    const normalizedPhone = normalizePhone(phone);
    const users = await this.db.query<User>(
      `SELECT id, email, phone, email_verified as "emailVerified",
       phone_verified as "phoneVerified", google_id as "googleId",
       display_name as "displayName", avatar_url as "avatarUrl",
       created_at as "createdAt", updated_at as "updatedAt"
       FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [normalizedPhone],
    );
    return users[0] ?? null;
  }

  async getUserById(userId: string): Promise<User | null> {
    const users = await this.db.query<User>(
      `SELECT id, email, phone, email_verified as "emailVerified",
       phone_verified as "phoneVerified", google_id as "googleId",
       display_name as "displayName", avatar_url as "avatarUrl",
       created_at as "createdAt", updated_at as "updatedAt"
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    return users[0] ?? null;
  }

  private async createUser(data: {
    email?: string;
    phone?: string;
    emailVerified?: boolean;
    phoneVerified?: boolean;
    googleId?: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  }): Promise<User> {
    const id = generateId();
    const now = nowISO();

    await this.db.execute(
      `INSERT INTO users (id, email, phone, email_verified, phone_verified, google_id,
       display_name, avatar_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        data.email ?? null,
        data.phone ?? null,
        data.emailVerified ?? false,
        data.phoneVerified ?? false,
        data.googleId ?? null,
        data.displayName ?? null,
        data.avatarUrl ?? null,
        now,
        now,
      ],
    );

    return {
      id,
      email: data.email ?? null,
      phone: data.phone ?? null,
      emailVerified: data.emailVerified ?? false,
      phoneVerified: data.phoneVerified ?? false,
      googleId: data.googleId ?? null,
      displayName: data.displayName ?? null,
      avatarUrl: data.avatarUrl ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }
}
