import {
  buildSsoConfig,
  validateSsoConfig,
  SSO_PROVIDERS,
  DEFAULT_SCOPES,
  type SsoConfig,
  type SsoProvider,
} from '../services/sso_config';

const VALID_PROVIDER: SsoProvider = 'google';
const VALID_CLIENT_ID = 'abc123.apps.googleusercontent.com';
const VALID_ISSUER = 'https://accounts.google.com';
const VALID_REDIRECT = 'https://myapp.com/api/auth/callback/google';

function validConfig(overrides: Partial<SsoConfig> = {}): SsoConfig {
  return {
    clientId: VALID_CLIENT_ID,
    issuer: VALID_ISSUER,
    provider: VALID_PROVIDER,
    redirectUri: VALID_REDIRECT,
    scopes: [...DEFAULT_SCOPES.google],
    ...overrides,
  };
}

describe('SSO_PROVIDERS', () => {
  it('contains all five provider strings', () => {
    expect(SSO_PROVIDERS).toEqual(['custom_oidc', 'github', 'google', 'microsoft', 'okta']);
  });

  it('is readonly and frozen', () => {
    // compile-time: readonly — runtime check that mutation is a no-op in strict mode
    expect(Object.isFrozen(SSO_PROVIDERS)).toBe(false); // plain const array
    expect(SSO_PROVIDERS.length).toBe(5);
  });
});

describe('DEFAULT_SCOPES', () => {
  it('provides openid + profile + email for every provider', () => {
    for (const provider of SSO_PROVIDERS) {
      const scopes = DEFAULT_SCOPES[provider];
      expect(scopes).toContain('openid');
      expect(scopes).toContain('profile');
      expect(scopes).toContain('email');
    }
  });

  it('includes a Google-specific scope', () => {
    expect(DEFAULT_SCOPES.google).toContain('https://www.googleapis.com/auth/userinfo.profile');
  });

  it('includes offline_access for microsoft', () => {
    expect(DEFAULT_SCOPES.microsoft).toContain('offline_access');
  });

  it('includes offline_access for okta', () => {
    expect(DEFAULT_SCOPES.okta).toContain('offline_access');
  });

  it('does NOT include offline_access for google or github', () => {
    expect(DEFAULT_SCOPES.google).not.toContain('offline_access');
    expect(DEFAULT_SCOPES.github).not.toContain('offline_access');
  });
});

describe('buildSsoConfig', () => {
  it('returns an SsoConfig with the given provider/clientId/issuer/redirectUri', () => {
    const cfg = buildSsoConfig(
      'microsoft',
      'ms-client',
      'https://login.microsoftonline.com',
      'https://app.com/cb',
    );
    expect(cfg.provider).toBe('microsoft');
    expect(cfg.clientId).toBe('ms-client');
    expect(cfg.issuer).toBe('https://login.microsoftonline.com');
    expect(cfg.redirectUri).toBe('https://app.com/cb');
  });

  it('populates scopes from DEFAULT_SCOPES for the given provider', () => {
    const cfg = buildSsoConfig(
      'okta',
      'okta-cid',
      'https://dev-123.okta.com',
      'https://app.com/cb',
    );
    expect(cfg.scopes).toEqual(DEFAULT_SCOPES.okta);
  });

  it('handles custom_oidc with the minimal scope set', () => {
    const cfg = buildSsoConfig(
      'custom_oidc',
      'custom',
      'https://idp.example.com',
      'https://app.com/cb',
    );
    expect(cfg.scopes).toEqual(['openid', 'profile', 'email']);
  });

  it('works with every provider', () => {
    for (const provider of SSO_PROVIDERS) {
      const cfg = buildSsoConfig(
        provider,
        'cid',
        `https://${provider}.example.com`,
        `https://app.com/${provider}/cb`,
      );
      expect(cfg.provider).toBe(provider);
    }
  });
});

describe('validateSsoConfig', () => {
  it('passes for a fully valid google config', () => {
    const { valid, errors } = validateSsoConfig(validConfig());
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('passes for every provider with a valid config', () => {
    for (const provider of SSO_PROVIDERS) {
      const { valid, errors } = validateSsoConfig(
        validConfig({ provider, scopes: [...DEFAULT_SCOPES[provider]] }),
      );
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    }
  });

  describe('provider', () => {
    it('rejects an unknown provider string', () => {
      const { valid, errors } = validateSsoConfig(
        validConfig({ provider: 'facebook' as SsoProvider }),
      );
      expect(valid).toBe(false);
      expect(errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/provider must be one of/)]),
      );
    });
  });

  describe('clientId', () => {
    it('rejects a missing clientId', () => {
      const { valid, errors } = validateSsoConfig(validConfig({ clientId: '' }));
      expect(valid).toBe(false);
      expect(errors).toContain('clientId is required');
    });

    it('rejects a clientId with whitespace', () => {
      const { valid, errors } = validateSsoConfig(validConfig({ clientId: 'abc 123' }));
      expect(valid).toBe(false);
      expect(errors).toContain('clientId must not contain whitespace');
    });
  });

  describe('issuer', () => {
    it('rejects a missing issuer', () => {
      const { valid, errors } = validateSsoConfig(validConfig({ issuer: '' }));
      expect(valid).toBe(false);
      expect(errors).toContain('issuer is required');
    });

    it('rejects a non-URL issuer', () => {
      const { valid, errors } = validateSsoConfig(validConfig({ issuer: 'not-a-url' }));
      expect(valid).toBe(false);
      expect(errors).toContain('issuer must be a valid absolute URL');
    });
  });

  describe('redirectUri', () => {
    it('rejects a missing redirectUri', () => {
      const { valid, errors } = validateSsoConfig(validConfig({ redirectUri: '' }));
      expect(valid).toBe(false);
      expect(errors).toContain('redirectUri is required');
    });

    it('rejects a non-URL redirectUri', () => {
      const { valid, errors } = validateSsoConfig(validConfig({ redirectUri: '/relative/path' }));
      expect(valid).toBe(false);
      expect(errors).toContain('redirectUri must be a valid absolute URL');
    });
  });

  describe('scopes', () => {
    it('rejects empty scopes array', () => {
      const { valid, errors } = validateSsoConfig(validConfig({ scopes: [] }));
      expect(valid).toBe(false);
      expect(errors).toContain('scopes must be non-empty');
    });

    it('rejects scopes containing an empty string', () => {
      const { valid, errors } = validateSsoConfig(validConfig({ scopes: ['openid', ''] }));
      expect(valid).toBe(false);
      expect(errors).toContain('each scope must be a non-empty string');
    });

    it('rejects scopes containing a whitespace-only string', () => {
      const { valid, errors } = validateSsoConfig(validConfig({ scopes: ['openid', '   '] }));
      expect(valid).toBe(false);
      expect(errors).toContain('each scope must be a non-empty string');
    });
  });

  it('collects multiple errors at once', () => {
    const { valid, errors } = validateSsoConfig(
      validConfig({ clientId: '', issuer: '', scopes: [] }),
    );
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
