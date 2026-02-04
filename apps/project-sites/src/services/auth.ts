/**
 * Authentication service
 * Magic link, OTP, Google SSO, sessions
 */
import type { AppContext } from '../types.js';
import {
  generateSecureToken,
  generateOtpCode,
  generateUuid,
  hashToken,
  verifyTokenHash,
  generateCodeVerifier,
  generateCodeChallenge,
  base64UrlEncode,
  AuthError,
  NotFoundError,
  ValidationError,
  AUTH,
  AUDIT_ACTIONS,
} from '@project-sites/shared';

export class AuthService {
  constructor(private c: AppContext) {}

  private get db() {
    return this.c.get('db');
  }

  private get env() {
    return this.c.env;
  }

  // ============================================================================
  // MAGIC LINK
  // ============================================================================

  async createMagicLink(email: string): Promise<{ token: string }> {
    const token = generateSecureToken(AUTH.MAGIC_LINK_TOKEN_LENGTH);
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + AUTH.MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

    // Store magic link
    const { error } = await this.db.from('magic_links').insert({
      id: generateUuid(),
      email: email.toLowerCase(),
      token: tokenHash,
      expires_at: expiresAt.toISOString(),
      ip_address: this.c.req.header('CF-Connecting-IP'),
      user_agent: this.c.req.header('User-Agent')?.slice(0, 500),
    });

    if (error) throw error;

    // Send email via SendGrid
    await this.sendMagicLinkEmail(email, token);

    // Log audit event
    await this.logAudit(AUDIT_ACTIONS.AUTH_MAGIC_LINK_SENT, 'user', null, { email });

    return { token };
  }

  async verifyMagicLink(token: string): Promise<{
    session_token: string;
    expires_at: string;
    user: { id: string; email: string };
  }> {
    const tokenHash = await hashToken(token);

    // Find magic link
    const { data: magicLink, error } = await this.db
      .from('magic_links')
      .select('*')
      .eq('token', tokenHash)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !magicLink) {
      throw new AuthError('Invalid or expired magic link', 'INVALID_TOKEN');
    }

    // Mark as used
    await this.db
      .from('magic_links')
      .update({ used_at: new Date().toISOString() })
      .eq('id', magicLink.id);

    // Get or create user
    const user = await this.getOrCreateUser(magicLink.email);

    // Mark email as verified
    await this.db
      .from('users')
      .update({ email_verified: true, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    // Create session
    const session = await this.createSession(user.id);

    // Log audit event
    await this.logAudit(AUDIT_ACTIONS.AUTH_MAGIC_LINK_VERIFIED, 'user', user.id, { email: user.email });

    return {
      session_token: session.token,
      expires_at: session.expires_at,
      user: { id: user.id, email: user.email },
    };
  }

  // ============================================================================
  // PHONE OTP
  // ============================================================================

  async createPhoneOtp(phone: string): Promise<void> {
    const code = generateOtpCode(AUTH.OTP_CODE_LENGTH);
    const codeHash = await hashToken(code);
    const expiresAt = new Date(Date.now() + AUTH.OTP_EXPIRY_MINUTES * 60 * 1000);

    // Invalidate existing OTPs for this phone
    await this.db
      .from('phone_otps')
      .update({ verified_at: new Date().toISOString() })
      .eq('phone', phone)
      .is('verified_at', null);

    // Store new OTP
    const { error } = await this.db.from('phone_otps').insert({
      id: generateUuid(),
      phone,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
      ip_address: this.c.req.header('CF-Connecting-IP'),
    });

    if (error) throw error;

    // Send SMS (placeholder - implement with SMS provider)
    await this.sendOtpSms(phone, code);

    // Log audit event
    await this.logAudit(AUDIT_ACTIONS.AUTH_OTP_SENT, 'user', null, { phone });
  }

  async verifyPhoneOtp(phone: string, code: string): Promise<{
    session_token: string;
    expires_at: string;
    user: { id: string; email: string };
  }> {
    // Find OTP
    const { data: otp, error } = await this.db
      .from('phone_otps')
      .select('*')
      .eq('phone', phone)
      .is('verified_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !otp) {
      throw new AuthError('Invalid or expired OTP', 'OTP_EXPIRED');
    }

    // Check attempts
    if (otp.attempts >= AUTH.OTP_MAX_ATTEMPTS) {
      throw new AuthError('Maximum verification attempts exceeded', 'OTP_MAX_ATTEMPTS');
    }

    // Verify code
    const isValid = await verifyTokenHash(code, otp.code_hash);

    if (!isValid) {
      // Increment attempts
      await this.db
        .from('phone_otps')
        .update({ attempts: otp.attempts + 1 })
        .eq('id', otp.id);

      throw new AuthError('Invalid OTP code', 'OTP_INVALID');
    }

    // Mark as verified
    await this.db
      .from('phone_otps')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', otp.id);

    // Find user with this phone or create new
    let { data: user } = await this.db
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!user) {
      // Check if there's an authed user to associate phone with
      const auth = this.c.get('auth');
      if (auth?.user_id) {
        await this.db
          .from('users')
          .update({
            phone,
            phone_verified: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', auth.user_id);

        const { data } = await this.db
          .from('users')
          .select('*')
          .eq('id', auth.user_id)
          .single();
        user = data;
      }
    }

    if (!user) {
      throw new AuthError('User not found. Please sign up with email first.');
    }

    // Mark phone as verified
    await this.db
      .from('users')
      .update({ phone_verified: true, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    // Create session
    const session = await this.createSession(user.id);

    // Log audit event
    await this.logAudit(AUDIT_ACTIONS.AUTH_OTP_VERIFIED, 'user', user.id, { phone });

    return {
      session_token: session.token,
      expires_at: session.expires_at,
      user: { id: user.id, email: user.email },
    };
  }

  // ============================================================================
  // GOOGLE OAUTH
  // ============================================================================

  async createGoogleOAuthUrl(redirectUri: string): Promise<string> {
    const state = generateSecureToken(32);
    const nonce = generateSecureToken(32);
    const codeVerifier = generateCodeVerifier(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // Store OAuth state
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const { error } = await this.db.from('oauth_states').insert({
      id: generateUuid(),
      state,
      nonce,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      expires_at: expiresAt.toISOString(),
    });

    if (error) throw error;

    // Build Google OAuth URL
    const params = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID,
      redirect_uri: `https://sites.megabyte.space/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async handleGoogleCallback(
    code: string,
    state: string
  ): Promise<{
    session: { session_token: string; expires_at: string };
    redirect_uri: string;
  }> {
    // Verify state
    const { data: oauthState, error } = await this.db
      .from('oauth_states')
      .select('*')
      .eq('state', state)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !oauthState) {
      throw new AuthError('Invalid OAuth state');
    }

    // Mark as used
    await this.db
      .from('oauth_states')
      .update({ used_at: new Date().toISOString() })
      .eq('id', oauthState.id);

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.env.GOOGLE_CLIENT_ID,
        client_secret: this.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `https://sites.megabyte.space/api/auth/google/callback`,
        code_verifier: oauthState.code_verifier,
      }),
    });

    if (!tokenResponse.ok) {
      throw new AuthError('Failed to exchange OAuth code');
    }

    const tokens = await tokenResponse.json() as { access_token: string };

    // Get user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new AuthError('Failed to get user info');
    }

    const userInfo = await userInfoResponse.json() as {
      id: string;
      email: string;
      name?: string;
      picture?: string;
    };

    // Get or create user
    const user = await this.getOrCreateUser(userInfo.email, {
      display_name: userInfo.name,
      avatar_url: userInfo.picture,
    });

    // Mark email as verified (Google has verified it)
    await this.db
      .from('users')
      .update({ email_verified: true, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    // Create session
    const session = await this.createSession(user.id);

    // Log audit event
    await this.logAudit(AUDIT_ACTIONS.AUTH_GOOGLE_LOGIN, 'user', user.id, { email: user.email });

    return {
      session: {
        session_token: session.token,
        expires_at: session.expires_at,
      },
      redirect_uri: oauthState.redirect_uri,
    };
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  async createSession(userId: string): Promise<{ token: string; expires_at: string }> {
    const token = generateSecureToken(AUTH.SESSION_TOKEN_LENGTH);
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + AUTH.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const { error } = await this.db.from('sessions').insert({
      id: generateUuid(),
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      ip_address: this.c.req.header('CF-Connecting-IP'),
      user_agent: this.c.req.header('User-Agent')?.slice(0, 500),
    });

    if (error) throw error;

    return { token, expires_at: expiresAt.toISOString() };
  }

  async getUserSessions(userId: string): Promise<any[]> {
    const { data: sessions, error } = await this.db
      .from('sessions')
      .select('id, ip_address, user_agent, device_name, last_active_at, created_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('last_active_at', { ascending: false });

    if (error) throw error;
    return sessions || [];
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    const { error } = await this.db
      .from('sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', userId);

    if (error) throw error;

    await this.logAudit(AUDIT_ACTIONS.AUTH_SESSION_REVOKED, 'user', userId, { session_id: sessionId });
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private async getOrCreateUser(
    email: string,
    extra?: { display_name?: string; avatar_url?: string }
  ): Promise<{ id: string; email: string }> {
    // Try to find existing user
    let { data: user } = await this.db
      .from('users')
      .select('id, email')
      .eq('email', email.toLowerCase())
      .single();

    if (!user) {
      // Create new user and org
      const userId = generateUuid();
      const orgId = generateUuid();

      // Create org first
      await this.db.from('orgs').insert({
        id: orgId,
        name: extra?.display_name || email.split('@')[0],
        slug: email.split('@')[0].replace(/[^a-z0-9]/gi, '-').toLowerCase(),
      });

      // Create user
      const { data: newUser, error: userError } = await this.db
        .from('users')
        .insert({
          id: userId,
          email: email.toLowerCase(),
          display_name: extra?.display_name,
          avatar_url: extra?.avatar_url,
        })
        .select('id, email')
        .single();

      if (userError) throw userError;

      // Create owner membership
      await this.db.from('memberships').insert({
        id: generateUuid(),
        org_id: orgId,
        user_id: userId,
        role: 'owner',
        billing_admin: true,
      });

      user = newUser;
    }

    return user;
  }

  private async sendMagicLinkEmail(email: string, token: string): Promise<void> {
    const magicLinkUrl = `https://sites.megabyte.space/api/auth/magic-link/verify?token=${token}`;

    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: 'noreply@megabyte.space', name: 'Project Sites' },
        reply_to: { email: 'brian@megabyte.space' },
        subject: 'Sign in to Project Sites',
        content: [
          {
            type: 'text/html',
            value: `
              <p>Click the link below to sign in to Project Sites:</p>
              <p><a href="${magicLinkUrl}">Sign in to Project Sites</a></p>
              <p>This link expires in ${AUTH.MAGIC_LINK_EXPIRY_HOURS} hours.</p>
              <p>If you didn't request this email, you can safely ignore it.</p>
            `,
          },
        ],
      }),
    });
  }

  private async sendOtpSms(phone: string, code: string): Promise<void> {
    // Placeholder - implement with SMS provider (Twilio, etc.)
    console.log(`OTP for ${phone}: ${code}`);
  }

  private async logAudit(
    action: string,
    targetType: string,
    targetId: string | null,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const auth = this.c.get('auth');

    await this.db.from('audit_logs').insert({
      id: generateUuid(),
      org_id: auth?.org_id || '00000000-0000-0000-0000-000000000000',
      actor_id: auth?.user_id,
      actor_type: 'user',
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
      ip_address: this.c.req.header('CF-Connecting-IP'),
      user_agent: this.c.req.header('User-Agent')?.slice(0, 500),
      request_id: this.c.get('request_id'),
    });
  }
}
