export type Permission =
  | 'sites:read'
  | 'sites:write'
  | 'sites:delete'
  | 'billing:read'
  | 'billing:write'
  | 'domains:read'
  | 'domains:write'
  | 'team:read'
  | 'team:write'
  | 'analytics:read';

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

const ALL_PERMISSIONS = [
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
] as const satisfies readonly Permission[];

export const ROLE_PERMISSIONS = {
  admin: ALL_PERMISSIONS.filter((p) => p !== 'sites:delete'),
  editor: ['sites:read', 'sites:write', 'analytics:read'] as const satisfies readonly Permission[],
  owner: ALL_PERMISSIONS,
  viewer: ['sites:read', 'analytics:read'] as const satisfies readonly Permission[],
} as const satisfies Record<Role, readonly Permission[]>;

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].some((p) => p === permission);
}

export function listPermissions(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
