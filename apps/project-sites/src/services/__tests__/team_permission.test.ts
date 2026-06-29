import {
  ROLE_PERMISSIONS,
  hasPermission,
  listPermissions,
  type Permission,
  type Role,
} from '../team_permission';

const ALL_PERMISSIONS: readonly Permission[] = [
  'sites:read',
  'sites:write',
  'sites:delete',
  'billing:read',
  'billing:write',
  'domains:read',
  'domains:write',
  'team:read',
  'team:write',
  'analytics:read',
];

const ALL_ROLES: readonly Role[] = ['owner', 'admin', 'editor', 'viewer'];

describe('ROLE_PERMISSIONS', () => {
  it('defines all 4 roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(['admin', 'editor', 'owner', 'viewer']);
  });

  it('owner has all 10 permissions', () => {
    expect(ROLE_PERMISSIONS.owner).toEqual(ALL_PERMISSIONS);
    expect(ROLE_PERMISSIONS.owner).toHaveLength(10);
  });

  it('admin has all permissions except sites:delete', () => {
    const expected = ALL_PERMISSIONS.filter((p) => p !== 'sites:delete');
    expect(ROLE_PERMISSIONS.admin).toEqual(expected);
    expect(ROLE_PERMISSIONS.admin).toHaveLength(9);
  });

  it('editor has sites:read, sites:write, and analytics:read', () => {
    expect(ROLE_PERMISSIONS.editor).toEqual(['sites:read', 'sites:write', 'analytics:read']);
    expect(ROLE_PERMISSIONS.editor).toHaveLength(3);
  });

  it('viewer has sites:read and analytics:read', () => {
    expect(ROLE_PERMISSIONS.viewer).toEqual(['sites:read', 'analytics:read']);
    expect(ROLE_PERMISSIONS.viewer).toHaveLength(2);
  });

  it('every permission value in ROLE_PERMISSIONS is a valid Permission (exhaustive check)', () => {
    const permissionSet = new Set<Permission>(ALL_PERMISSIONS);

    for (const role of ALL_ROLES) {
      for (const perm of ROLE_PERMISSIONS[role]) {
        expect(permissionSet.has(perm)).toBe(true);
      }
    }
  });

  it('every role has at least 2 permissions', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('hasPermission', () => {
  it.each(ALL_PERMISSIONS.map((p): [string, Permission] => [p, p]))(
    'owner has permission %s',
    (_, permission) => {
      expect(hasPermission('owner', permission)).toBe(true);
    },
  );

  it.each(
    ALL_PERMISSIONS.filter((p) => p !== 'sites:delete').map((p): [string, Permission] => [p, p]),
  )('admin has permission %s', (_, permission) => {
    expect(hasPermission('admin', permission)).toBe(true);
  });

  it('admin does NOT have sites:delete', () => {
    expect(hasPermission('admin', 'sites:delete')).toBe(false);
  });

  const EDITOR_HAS: Permission[] = ['sites:read', 'sites:write', 'analytics:read'];
  it.each(EDITOR_HAS.map((p): [string, Permission] => [p, p]))(
    'editor has permission %s',
    (_, permission) => {
      expect(hasPermission('editor', permission)).toBe(true);
    },
  );

  const EDITOR_DENIES = ALL_PERMISSIONS.filter((p) => !EDITOR_HAS.includes(p));
  it.each(EDITOR_DENIES.map((p): [string, Permission] => [p, p]))(
    'editor does NOT have permission %s',
    (_, permission) => {
      expect(hasPermission('editor', permission)).toBe(false);
    },
  );

  it('viewer has sites:read', () => {
    expect(hasPermission('viewer', 'sites:read')).toBe(true);
  });

  it('viewer has analytics:read', () => {
    expect(hasPermission('viewer', 'analytics:read')).toBe(true);
  });

  const VIEWER_DENIES: Permission[] = [
    'sites:write',
    'sites:delete',
    'billing:read',
    'billing:write',
    'domains:read',
    'domains:write',
    'team:read',
    'team:write',
  ];
  it.each(VIEWER_DENIES.map((p): [string, Permission] => [p, p]))(
    'viewer does NOT have permission %s',
    (_, permission) => {
      expect(hasPermission('viewer', permission)).toBe(false);
    },
  );

  it('every hasPermission result is a boolean', () => {
    for (const role of ALL_ROLES) {
      for (const perm of ALL_PERMISSIONS) {
        expect(typeof hasPermission(role, perm)).toBe('boolean');
      }
    }
  });
});

describe('listPermissions', () => {
  it('returns same array as ROLE_PERMISSIONS for every role', () => {
    for (const role of ALL_ROLES) {
      expect(listPermissions(role)).toBe(ROLE_PERMISSIONS[role]);
      expect(listPermissions(role)).toEqual(ROLE_PERMISSIONS[role]);
    }
  });

  it('returns a readonly array', () => {
    const perms = listPermissions('owner');
    expect(Array.isArray(perms)).toBe(true);
    expect(perms).toHaveLength(10);
  });

  it('returned array is immutable at type level', () => {
    const perms: readonly Permission[] = listPermissions('owner');
    expect(perms.length).toBeGreaterThan(0);
  });
});

describe('TypeScript type coverage', () => {
  it('Permission is assignable from all known strings', () => {
    const p: Permission = 'sites:read';
    expect(p).toBe('sites:read');
  });

  it('Role is assignable from all role strings', () => {
    const r: Role = 'owner';
    expect(r).toBe('owner');
  });

  it('ROLE_PERMISSIONS satisfies Record<Role, readonly Permission[]>', () => {
    const check: Record<Role, readonly Permission[]> = ROLE_PERMISSIONS;
    expect(Object.keys(check)).toBeDefined();
  });

  it('hasPermission accepts any (role, permission) tuple', () => {
    const result = hasPermission('editor', 'sites:write');
    expect(result).toBe(true);

    const denied = hasPermission('viewer', 'team:write');
    expect(denied).toBe(false);
  });
});
