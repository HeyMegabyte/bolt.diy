/**
 * GitHub OAuth adapter unit tests.
 */
import { GitHubOAuthAdapter } from '../github.js';

describe('GitHubOAuthAdapter', () => {
  const configured = new GitHubOAuthAdapter({
    GITHUB_CLIENT_ID: 'gh-test-id',
    GITHUB_CLIENT_SECRET: 'gh-test-secret',
  });

  const unconfigured = new GitHubOAuthAdapter({});

  describe('authorizeUrl', () => {
    test('returns valid GitHub auth URL when configured', () => {
      const url = configured.authorizeUrl('https://example.com/callback', 'state-abc');
      expect(url).toContain('https://github.com/login/oauth/authorize');
      expect(url).toContain('client_id=gh-test-id');
      expect(url).toContain('scope=read%3Auser+user%3Aemail');
      expect(url).toContain('state=state-abc');
    });

    test('throws when client ID is not configured', () => {
      expect(() => unconfigured.authorizeUrl('https://x.com/cb', 's')).toThrow(
        'GITHUB_CLIENT_ID not configured',
      );
    });
  });

  describe('exchangeCode', () => {
    test('returns null when not configured', async () => {
      const result = await unconfigured.exchangeCode('code', 'https://example.com/cb');
      expect(result).toBeNull();
    });
  });

  describe('refreshToken', () => {
    test('returns null (GitHub tokens do not expire)', async () => {
      const result = await configured.refreshToken('any-token');
      expect(result).toBeNull();
    });
  });

  describe('provider', () => {
    test('returns "github"', () => {
      expect(configured.provider).toBe('github');
    });
  });
});
