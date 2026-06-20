/**
 * @module platform/authorization
 *
 * @description
 * Authorization port + in-memory provider (convergence §29 — OpenFGA-as-graph,
 * NOT authentication). App code calls `authz.check({ user, relation, object })`
 * on dashboard/API/admin/mutation paths (never on the public static hot path).
 * Default deny: anything not explicitly granted is refused.
 *
 * This slice lands the port, a `DenyAllAuthorizationProvider` (the safe,
 * fail-closed default when OpenFGA is unconfigured — §58), and a
 * `FakeAuthorizationProvider` that models the §29 role→permission graph in
 * memory (the §16 local mode + the test substrate). The real
 * `OpenFgaAuthorizationProvider` is the follow-on adapter.
 *
 * @see docs/adr/0005-openfga-authorization-graph.md
 */

/** A relationship/permission check: does `user` have `relation` on `object`? */
export interface AuthorizationCheckInput {
  readonly user: string;
  readonly relation: string;
  readonly object: string;
}

export interface AuthorizationProvider {
  check(input: AuthorizationCheckInput): Promise<boolean>;
  batchCheck(inputs: readonly AuthorizationCheckInput[]): Promise<boolean[]>;
  writeRelationship(input: AuthorizationCheckInput): Promise<void>;
  deleteRelationship(input: AuthorizationCheckInput): Promise<void>;
  listObjects(input: { user: string; relation: string }): Promise<string[]>;
}

/** Direct role relations a user can hold on an object (site/account/platform). */
export const ROLE_RELATIONS = ['owner', 'editor', 'viewer', 'agency', 'platform_admin'] as const;
export type RoleRelation = (typeof ROLE_RELATIONS)[number];

/**
 * Permission → the set of roles that grant it (§29). Default-deny: a permission
 * not listed here is granted to no one.
 */
export const PERMISSION_RULES: Readonly<Record<string, ReadonlySet<RoleRelation>>> = {
  can_view: new Set(['owner', 'editor', 'viewer', 'agency']),
  can_view_analytics: new Set(['owner', 'editor', 'viewer', 'agency']),
  can_edit: new Set(['owner', 'editor', 'agency']),
  can_publish: new Set(['owner', 'agency']),
  can_manage_domain: new Set(['owner', 'agency']),
  can_manage_billing: new Set(['owner']),
  can_manage_api_keys: new Set(['owner']),
  platform_action: new Set(['platform_admin']),
};

function isRole(relation: string): relation is RoleRelation {
  return (ROLE_RELATIONS as readonly string[]).includes(relation);
}

/** Fail-closed default: denies every check. Used when OpenFGA is unconfigured. */
export class DenyAllAuthorizationProvider implements AuthorizationProvider {
  async check(): Promise<boolean> {
    return false;
  }
  async batchCheck(inputs: readonly AuthorizationCheckInput[]): Promise<boolean[]> {
    return inputs.map(() => false);
  }
  async writeRelationship(): Promise<void> {}
  async deleteRelationship(): Promise<void> {}
  async listObjects(): Promise<string[]> {
    return [];
  }
}

/**
 * In-memory authorization graph (the §29 model). Stores direct role tuples;
 * resolves permission checks via {@link PERMISSION_RULES}. Default deny.
 *
 * @example
 * const authz = new FakeAuthorizationProvider();
 * await authz.writeRelationship({ user: 'u1', relation: 'owner', object: 'site:a' });
 * await authz.check({ user: 'u1', relation: 'can_publish', object: 'site:a' }); // true
 */
export class FakeAuthorizationProvider implements AuthorizationProvider {
  /** `object` → set of `user#relation` tuples. */
  private readonly tuples = new Set<string>();

  private key(t: AuthorizationCheckInput): string {
    return `${t.user}#${t.relation}@${t.object}`;
  }

  async writeRelationship(input: AuthorizationCheckInput): Promise<void> {
    this.tuples.add(this.key(input));
  }

  async deleteRelationship(input: AuthorizationCheckInput): Promise<void> {
    this.tuples.delete(this.key(input));
  }

  async check(input: AuthorizationCheckInput): Promise<boolean> {
    // Direct role check → exact tuple.
    if (isRole(input.relation)) return this.tuples.has(this.key(input));

    // Permission check → user holds ANY granting role on the object.
    const granting = PERMISSION_RULES[input.relation];
    if (!granting) return false; // unknown permission → deny
    for (const role of granting) {
      if (this.tuples.has(`${input.user}#${role}@${input.object}`)) return true;
    }
    return false;
  }

  async batchCheck(inputs: readonly AuthorizationCheckInput[]): Promise<boolean[]> {
    return Promise.all(inputs.map((i) => this.check(i)));
  }

  async listObjects(input: { user: string; relation: string }): Promise<string[]> {
    const out = new Set<string>();
    for (const t of this.tuples) {
      const [userRel, object] = t.split('@');
      const [user] = userRel.split('#');
      if (user !== input.user) continue;
      if (await this.check({ user: input.user, relation: input.relation, object })) out.add(object);
    }
    return [...out];
  }
}
