import {
  mapOidcClaims,
  mergeProfiles,
  PROVIDER_FIELDS,
  type MappedProfile,
  type OidcProfile,
} from '../sso_mapper';

/** Google OIDC userinfo response shape. */
const GOOGLE_CLAIMS: OidcProfile = {
  sub: '108594395490581619296',
  email: 'alice@gmail.com',
  email_verified: true,
  name: 'Alice Johnson',
  picture: 'https://lh3.googleusercontent.com/a/photo.jpg',
  given_name: 'Alice',
  family_name: 'Johnson',
  locale: 'en',
};

/** GitHub user API shape. */
const GITHUB_CLAIMS: OidcProfile = {
  id: 1_234_567,
  node_id: 'MDQ6VXNlcjEyMzQ1Njc=',
  login: 'alice-dev',
  name: 'Alice Johnson (dev)',
  avatar_url: 'https://avatars.githubusercontent.com/u/1234567?v=4',
  email: 'alice.work@gmail.com',
  type: 'User',
};

/** Microsoft / Azure AD shape (oid instead of sub). */
const MICROSOFT_CLAIMS: OidcProfile = {
  oid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  email: 'alice@contoso.com',
  name: 'Alice Johnson',
  preferred_username: 'alice@contoso.com',
};

/** Minimal custom OIDC provider with only standard claims. */
const CUSTOM_CLAIMS: OidcProfile = {
  sub: 'user-custom-001',
  email: 'alice@customidp.com',
  name: 'Alice',
  picture: 'https://customidp.com/avatar.png',
};

/** Minimal profile — just sub and nothing else. */
const MINIMAL_CLAIMS: OidcProfile = {
  sub: 'minimal-user',
};

/** GitHub-like claims where id is a string form of the number. */
const GITHUB_STRING_ID: OidcProfile = {
  id: 'GH-ABCDEF',
  login: 'alice-str',
  email: 'alice.str@example.com',
};

/** Claims with non-string providerId value (number or bigint). */
const NUMERIC_ID_CLAIMS: OidcProfile = {
  id: 999_888_777,
  email: 'numeric@example.com',
  name: 'Numeric User',
};

describe('PROVIDER_FIELDS', () => {
  it('lists all five providers', () => {
    expect(Object.keys(PROVIDER_FIELDS)).toEqual([
      'custom_oidc',
      'github',
      'google',
      'microsoft',
      'okta',
    ]);
  });

  it('each provider entry has exactly 4 field keys', () => {
    for (const entry of Object.values(PROVIDER_FIELDS)) {
      expect(entry).toHaveLength(4);
    }
  });

  it('google maps to email, name, picture, sub', () => {
    expect(PROVIDER_FIELDS.google).toEqual(['email', 'name', 'picture', 'sub']);
  });

  it('github maps to email, name, avatar_url, id', () => {
    expect(PROVIDER_FIELDS.github).toEqual(['email', 'name', 'avatar_url', 'id']);
  });

  it('microsoft, okta, custom_oidc all use the standard OIDC keys', () => {
    for (const p of ['microsoft', 'okta', 'custom_oidc'] as const) {
      expect(PROVIDER_FIELDS[p]).toEqual(['email', 'name', 'picture', 'sub']);
    }
  });
});

describe('mapOidcClaims', () => {
  describe('google', () => {
    it('extracts all four fields from Google userinfo', () => {
      const result = mapOidcClaims(GOOGLE_CLAIMS, 'google');

      expect(result.email).toBe('alice@gmail.com');
      expect(result.name).toBe('Alice Johnson');
      expect(result.avatar).toBe('https://lh3.googleusercontent.com/a/photo.jpg');
      expect(result.providerId).toBe('108594395490581619296');
    });

    it('returns null for missing avatar when picture is absent', () => {
      const { email, name, avatar, providerId } = mapOidcClaims(
        { sub: 'abc', email: 'no@pic.com', name: 'No Pic' },
        'google',
      );
      expect(email).toBe('no@pic.com');
      expect(name).toBe('No Pic');
      expect(avatar).toBeNull();
      expect(providerId).toBe('abc');
    });

    it('returns null for missing email and name when not provided', () => {
      const result = mapOidcClaims({ sub: 'abc123' }, 'google');
      expect(result.email).toBeNull();
      expect(result.name).toBeNull();
      expect(result.avatar).toBeNull();
      expect(result.providerId).toBe('abc123');
    });
  });

  describe('github', () => {
    it('extracts all four fields from GitHub user API, coercing numeric id to string', () => {
      const result = mapOidcClaims(GITHUB_CLAIMS, 'github');

      expect(result.email).toBe('alice.work@gmail.com');
      expect(result.name).toBe('Alice Johnson (dev)');
      expect(result.avatar).toBe('https://avatars.githubusercontent.com/u/1234567?v=4');
      expect(result.providerId).toBe('1234567');
    });

    it('reads login as name fallback when name is absent', () => {
      const result = mapOidcClaims(
        { id: 42, login: 'alice-only', avatar_url: 'https://a.v', email: 'a@b.com' },
        'github',
      );
      expect(result.email).toBe('a@b.com');
      expect(result.name).toBe('alice-only');
      expect(result.avatar).toBe('https://a.v');
      expect(result.providerId).toBe('42');
    });

    it('coerces a numeric id to string', () => {
      const result = mapOidcClaims(NUMERIC_ID_CLAIMS, 'github');
      expect(result.providerId).toBe('999888777');
      expect(result.email).toBe('numeric@example.com');
    });
  });

  describe('microsoft', () => {
    it('extracts fields from Azure AD claims', () => {
      const result = mapOidcClaims(MICROSOFT_CLAIMS, 'microsoft');

      expect(result.email).toBe('alice@contoso.com');
      expect(result.name).toBe('Alice Johnson');
      expect(result.avatar).toBeNull();
      expect(result.providerId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('prefers sub over oid when both are present', () => {
      const result = mapOidcClaims(MICROSOFT_CLAIMS, 'microsoft');
      // PROVIDER_FIELDS.microsoft reads 'sub' — both are present, sub wins
      expect(result.providerId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });
  });

  describe('custom_oidc', () => {
    it('extracts from standard OIDC claims', () => {
      const result = mapOidcClaims(CUSTOM_CLAIMS, 'custom_oidc');

      expect(result.email).toBe('alice@customidp.com');
      expect(result.name).toBe('Alice');
      expect(result.avatar).toBe('https://customidp.com/avatar.png');
      expect(result.providerId).toBe('user-custom-001');
    });
  });

  describe('unknown provider', () => {
    it('falls back to standard OIDC keys for an unrecognized provider', () => {
      const result = mapOidcClaims(CUSTOM_CLAIMS, 'unknown-idp');

      expect(result.email).toBe('alice@customidp.com');
      expect(result.name).toBe('Alice');
      expect(result.avatar).toBe('https://customidp.com/avatar.png');
      expect(result.providerId).toBe('user-custom-001');
    });

    it('returns empty string providerId when neither custom key nor sub exists', () => {
      const result = mapOidcClaims({ email: 'x@y.com' }, 'mystery');
      expect(result.email).toBe('x@y.com');
      expect(result.providerId).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles empty claims object', () => {
      const result = mapOidcClaims({}, 'google');
      expect(result.email).toBeNull();
      expect(result.name).toBeNull();
      expect(result.avatar).toBeNull();
      expect(result.providerId).toBe('');
    });

    it('handles null values in claims', () => {
      const result = mapOidcClaims(
        { sub: 's1', email: null, name: null, picture: null },
        'google',
      );
      expect(result.email).toBeNull();
      expect(result.name).toBeNull();
      expect(result.avatar).toBeNull();
      expect(result.providerId).toBe('s1');
    });

    it('ignores empty-string claim values', () => {
      const result = mapOidcClaims(
        { sub: 's1', email: '', name: '  ', picture: 'https://p.com/img.jpg' },
        'google',
      );
      expect(result.email).toBeNull();
      expect(result.name).toBeNull();
      expect(result.avatar).toBe('https://p.com/img.jpg');
      expect(result.providerId).toBe('s1');
    });

    it('handles string-format id from GitHub', () => {
      const result = mapOidcClaims(GITHUB_STRING_ID, 'github');
      expect(result.providerId).toBe('GH-ABCDEF');
      expect(result.email).toBe('alice.str@example.com');
    });

    it('does not return providerId from a field that holds an array', () => {
      const result = mapOidcClaims({ sub: 'real-id', roles: ['admin'] }, 'google');
      expect(result.providerId).toBe('real-id');
    });
  });
});

describe('mergeProfiles', () => {
  it('merges two profiles, taking first non-null for each field', () => {
    const result = mergeProfiles([
      { email: 'a@gmail.com', name: 'Alice G', avatar: null, providerId: 'g1' },
      { email: null, name: 'alice_dev', avatar: 'https://gh.av', providerId: 'gh1' },
    ]);

    expect(result).toEqual({
      email: 'a@gmail.com',
      name: 'Alice G',
      avatar: 'https://gh.av',
      providerId: 'g1',
    });
  });

  it('fills null fields from later profiles when earlier ones lack them', () => {
    const result = mergeProfiles([
      { email: null, name: null, avatar: null, providerId: 'first' },
      { email: 'second@x.com', name: null, avatar: null, providerId: 'second' },
      { email: null, name: 'Third', avatar: 'https://third.av', providerId: 'third' },
    ]);

    expect(result).toEqual({
      email: 'second@x.com',
      name: 'Third',
      avatar: 'https://third.av',
      providerId: 'first',
    });
  });

  it('returns null for empty array', () => {
    expect(mergeProfiles([])).toBeNull();
  });

  it('returns the single profile unchanged for a single-element array', () => {
    const single: MappedProfile = {
      email: 'only@x.com',
      name: 'Only',
      avatar: 'https://only.av',
      providerId: 'only-1',
    };
    const result = mergeProfiles([single]);

    expect(result).toEqual(single);
  });

  it('keeps first providerId, ignoring later ones', () => {
    const result = mergeProfiles([
      { email: 'a@b.com', name: 'A', avatar: null, providerId: 'keep-this' },
      { email: 'b@c.com', name: 'B', avatar: null, providerId: 'ignore-this' },
    ]);

    expect(result?.providerId).toBe('keep-this');
    expect(result?.email).toBe('a@b.com');
  });

  it('does not overwrite a non-null field with a null from a later profile', () => {
    const result = mergeProfiles([
      { email: 'a@b.com', name: 'A', avatar: 'https://a.av', providerId: 'p1' },
      { email: null, name: null, avatar: null, providerId: 'p2' },
    ]);

    expect(result).toEqual({
      email: 'a@b.com',
      name: 'A',
      avatar: 'https://a.av',
      providerId: 'p1',
    });
  });

  it('does not mutate the input array', () => {
    const input: MappedProfile[] = [
      { email: 'a@b.com', name: 'A', avatar: null, providerId: 'p1' },
    ];
    const copy = [...input];
    mergeProfiles(input);
    expect(input).toEqual(copy);
  });
});

describe('TypeScript contract', () => {
  it('MappedProfile is a valid structural type', () => {
    const p: MappedProfile = {
      email: 'test@example.com',
      name: 'Test User',
      avatar: null,
      providerId: 'provider-abc',
    };
    expect(p.email).toBe('test@example.com');
    expect(p.name).toBe('Test User');
  });

  it('mapOidcClaims result matches MappedProfile shape', () => {
    const result = mapOidcClaims(MINIMAL_CLAIMS, 'google');
    expect(result).toHaveProperty('email');
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('avatar');
    expect(result).toHaveProperty('providerId');
    expect(typeof result.providerId).toBe('string');
  });

  it('mergeProfiles returns null or MappedProfile', () => {
    const empty = mergeProfiles([]);
    expect(empty).toBeNull();

    const filled = mergeProfiles([{ email: null, name: null, avatar: null, providerId: 'x' }]);
    expect(filled).not.toBeNull();
    expect(filled?.providerId).toBe('x');
  });
});
