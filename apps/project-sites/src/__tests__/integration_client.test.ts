/**
 * @module __tests__/integration_client
 * @description Unit tests for the integration-client Zod schemas. Pure validation
 *   — every test calls `safeParse` or `parse` with known-good and known-bad input.
 */

import {
  ConnectionStatus,
  ProviderConfigSchema,
  ProviderScopeSchema,
  OAuthTokenSchema,
  ConnectionStateSchema,
  IntegrationConnectionSchema,
} from '../services/integration_client.js';

// ── ConnectionStatus ───────────────────────────────────────────────────────────

describe('ConnectionStatus', () => {
  it('accepts all four valid statuses', () => {
    for (const s of ['connected', 'disconnected', 'expired', 'error']) {
      expect(ConnectionStatus.parse(s)).toBe(s);
    }
  });

  it('rejects unknown statuses', () => {
    const r = ConnectionStatus.safeParse('pending');
    expect(r.success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(ConnectionStatus.safeParse('').success).toBe(false);
  });
});

// ── ProviderConfigSchema ───────────────────────────────────────────────────────

describe('ProviderConfigSchema', () => {
  const MINIMAL = { name: 'stripe' };

  it('parses a minimal config', () => {
    const r = ProviderConfigSchema.safeParse(MINIMAL);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('stripe');
      expect(r.data.clientId).toBe('');
      expect(r.data.scopes).toEqual([]);
      expect(r.data.redirectUri).toBeUndefined();
    }
  });

  it('parses a full config', () => {
    const input = {
      name: 'hubspot',
      clientId: 'hs_xxx',
      scopes: ['contacts.read', 'contacts.write'],
      redirectUri: 'https://projectsites.dev/api/mcp/hubspot/callback',
    };
    const r = ProviderConfigSchema.safeParse(input);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('hubspot');
      expect(r.data.scopes).toHaveLength(2);
    }
  });

  it('accepts paste-key config (empty clientId, no redirect)', () => {
    const r = ProviderConfigSchema.safeParse({ name: 'resend' });
    expect(r.success).toBe(true);
  });

  it('rejects missing name', () => {
    expect(ProviderConfigSchema.safeParse({}).success).toBe(false);
  });

  it('rejects name with uppercase characters', () => {
    expect(ProviderConfigSchema.safeParse({ name: 'Stripe' }).success).toBe(false);
  });

  it('rejects name with hyphens', () => {
    expect(ProviderConfigSchema.safeParse({ name: 'my-provider' }).success).toBe(false);
  });

  it('rejects invalid redirect URI', () => {
    const r = ProviderConfigSchema.safeParse({
      name: 'stripe',
      redirectUri: 'not-a-url',
    });
    expect(r.success).toBe(false);
  });

  it('rejects blank scopes entry', () => {
    const r = ProviderConfigSchema.safeParse({
      name: 'stripe',
      scopes: [''],
    });
    expect(r.success).toBe(false);
  });
});

// ── ProviderScopeSchema ────────────────────────────────────────────────────────

describe('ProviderScopeSchema', () => {
  it('accepts typical OAuth scopes', () => {
    for (const s of ['read', 'write', 'contacts.read', 'https://www.googleapis.com/auth/drive']) {
      expect(ProviderScopeSchema.parse(s)).toBe(s);
    }
  });

  it('rejects empty scope', () => {
    expect(ProviderScopeSchema.safeParse('').success).toBe(false);
  });

  it('rejects scope starting with non-alpha', () => {
    expect(ProviderScopeSchema.safeParse('_private').success).toBe(false);
  });
});

// ── OAuthTokenSchema ───────────────────────────────────────────────────────────

describe('OAuthTokenSchema', () => {
  const FULL_TOKEN = {
    accessToken: 'ya29.a0AfH6SMC…',
    refreshToken: '1//0gABC…',
    expiresAt: 1750000000000,
  };

  it('parses a token with refresh token', () => {
    const r = OAuthTokenSchema.safeParse(FULL_TOKEN);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.refreshToken).toBe('1//0gABC…');
    }
  });

  it('parses a token without refresh token', () => {
    const r = OAuthTokenSchema.safeParse({
      accessToken: 'sk-xxx',
      expiresAt: 1750000000000,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.refreshToken).toBeUndefined();
  });

  it('rejects missing accessToken', () => {
    expect(OAuthTokenSchema.safeParse({ expiresAt: 1750000000000 }).success).toBe(false);
  });

  it('rejects non-positive expiresAt', () => {
    expect(OAuthTokenSchema.safeParse({ accessToken: 'x', expiresAt: 0 }).success).toBe(false);
  });

  it('rejects zero expiresAt', () => {
    expect(OAuthTokenSchema.safeParse({ accessToken: 'x', expiresAt: 0 }).success).toBe(false);
  });
});

// ── ConnectionStateSchema ──────────────────────────────────────────────────────

describe('ConnectionStateSchema', () => {
  it('parses a connected state with token', () => {
    const r = ConnectionStateSchema.safeParse({
      status: 'connected',
      token: { accessToken: 'sk-…', expiresAt: 1750000000000 },
      lastCheckedAt: Date.now(),
    });
    expect(r.success).toBe(true);
  });

  it('parses a disconnected state without token', () => {
    const r = ConnectionStateSchema.safeParse({
      status: 'disconnected',
      lastCheckedAt: Date.now(),
    });
    expect(r.success).toBe(true);
  });

  it('parses an error state with message', () => {
    const r = ConnectionStateSchema.safeParse({
      status: 'error',
      errorMessage: 'Token refresh failed: 401',
      lastCheckedAt: Date.now(),
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing lastCheckedAt', () => {
    expect(ConnectionStateSchema.safeParse({ status: 'connected' }).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(
      ConnectionStateSchema.safeParse({
        status: 'unknown',
        lastCheckedAt: 1,
      }).success,
    ).toBe(false);
  });

  it('rejects overly long errorMessage', () => {
    const longMsg = 'x'.repeat(2000);
    const r = ConnectionStateSchema.safeParse({
      status: 'error',
      errorMessage: longMsg,
      lastCheckedAt: Date.now(),
    });
    expect(r.success).toBe(false);
  });
});

// ── IntegrationConnectionSchema ────────────────────────────────────────────────

describe('IntegrationConnectionSchema', () => {
  it('parses a full integration connection', () => {
    const r = IntegrationConnectionSchema.safeParse({
      provider: { name: 'stripe' },
      state: {
        status: 'connected',
        token: { accessToken: 'sk-…', expiresAt: 1750000000000 },
        lastCheckedAt: Date.now(),
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing provider', () => {
    expect(
      IntegrationConnectionSchema.safeParse({
        state: { status: 'disconnected', lastCheckedAt: 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects missing state', () => {
    expect(
      IntegrationConnectionSchema.safeParse({
        provider: { name: 'stripe' },
      }).success,
    ).toBe(false);
  });

  it('rejects bad provider name inside the composite', () => {
    const r = IntegrationConnectionSchema.safeParse({
      provider: { name: 'Stripe' },
      state: { status: 'disconnected', lastCheckedAt: 1 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects bad state status inside the composite', () => {
    const r = IntegrationConnectionSchema.safeParse({
      provider: { name: 'stripe' },
      state: { status: 'pending', lastCheckedAt: 1 },
    });
    expect(r.success).toBe(false);
  });
});
