/**
 * Google OAuth adapter unit tests.
 *
 * Tests authorize URL construction, token exchange, and token refresh
 * with both configured and unconfigured states.
 */
import { GoogleOAuthAdapter } from '../google.js';

describe('GoogleOAuthAdapter', () => {
  const configured = new GoogleOAuthAdapter({
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
  });

  const unconfigured = new GoogleOAuthAdapter({});

  describe('authorizeUrl', () => {
    test('returns valid Google auth URL when configured', () => {
      const url = configured.authorizeUrl('https://example.com/callback', 'state-123');
      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
      expect(url).toContain('state=state-123');
      expect(url).toContain('response_type=code');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain('scope=openid+profile+email');
    });

    test('throws when client ID is not configured', () => {
      expect(() => unconfigured.authorizeUrl('https://example.com/callback', 'state')).toThrow(
        'GOOGLE_CLIENT_ID not configured',
      );
    });
  });

  describe('exchangeCode', () => {
    test('returns null when not configured', async () => {
      const result = await unconfigured.exchangeCode('code', 'https://example.com/callback');
      expect(result).toBeNull();
    });
  });

  describe('refreshToken', () => {
    test('returns null when not configured', async () => {
      const result = await unconfigured.refreshToken('refresh-token');
      expect(result).toBeNull();
    });
  });

  describe('provider', () => {
    test('returns "google"', () => {
      expect(configured.provider).toBe('google');
    });
  });
});
