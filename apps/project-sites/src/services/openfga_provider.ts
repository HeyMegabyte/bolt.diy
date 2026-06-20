/**
 * @module services/openfga_provider
 *
 * @description
 * `OpenFgaAuthorizationProvider` — the real {@link AuthorizationProvider} (§29/
 * ADR-0005), talking to an OpenFGA store over REST (Workers-native fetch, no
 * SDK). Implements the port `check`/`batchCheck`/`writeRelationship`/
 * `deleteRelationship`/`listObjects`. Fail-closed: any non-2xx or network error
 * on a check resolves to `false` (deny) per §58.
 *
 * Injected `fetchImpl` → deterministic tests; prod uses global `fetch`. The
 * `getAuthorizationProvider` factory returns this when OpenFGA is configured,
 * else `DenyAllAuthorizationProvider`.
 *
 * @see docs/adr/0005-openfga-authorization-graph.md
 */

import type { AuthorizationCheckInput, AuthorizationProvider } from '../platform/authorization.js';

export interface OpenFgaConfig {
  readonly apiUrl: string;
  readonly storeId: string;
  readonly authToken?: string;
  readonly modelId?: string;
}

export class OpenFgaAuthorizationProvider implements AuthorizationProvider {
  constructor(
    private readonly cfg: OpenFgaConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.authToken) h.Authorization = `Bearer ${this.cfg.authToken}`;
    return h;
  }

  private url(path: string): string {
    return `${this.cfg.apiUrl.replace(/\/$/, '')}/stores/${this.cfg.storeId}${path}`;
  }

  async check(input: AuthorizationCheckInput): Promise<boolean> {
    try {
      const res = await this.fetchImpl(this.url('/check'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          tuple_key: { user: input.user, relation: input.relation, object: input.object },
          ...(this.cfg.modelId ? { authorization_model_id: this.cfg.modelId } : {}),
        }),
      });
      if (!res.ok) return false; // fail closed (§58)
      const json = (await res.json().catch(() => ({}))) as { allowed?: boolean };
      return json.allowed === true;
    } catch {
      return false; // network error → deny
    }
  }

  async batchCheck(inputs: readonly AuthorizationCheckInput[]): Promise<boolean[]> {
    return Promise.all(inputs.map((i) => this.check(i)));
  }

  async writeRelationship(input: AuthorizationCheckInput): Promise<void> {
    const res = await this.fetchImpl(this.url('/write'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        writes: {
          tuple_keys: [{ user: input.user, relation: input.relation, object: input.object }],
        },
      }),
    });
    if (!res.ok) throw new Error(`OpenFGA write failed: ${res.status}`);
  }

  async deleteRelationship(input: AuthorizationCheckInput): Promise<void> {
    const res = await this.fetchImpl(this.url('/write'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        deletes: {
          tuple_keys: [{ user: input.user, relation: input.relation, object: input.object }],
        },
      }),
    });
    if (!res.ok) throw new Error(`OpenFGA delete failed: ${res.status}`);
  }

  /**
   * List objects of a given type the user has `relation` on. OpenFGA requires an
   * object `type`; it is taken from the relation's conventional target (`site`)
   * unless the relation names another type. Returns [] on failure (fail-soft).
   */
  async listObjects(input: { user: string; relation: string; type?: string }): Promise<string[]> {
    try {
      const res = await this.fetchImpl(this.url('/list-objects'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          user: input.user,
          relation: input.relation,
          type: input.type ?? 'site',
          ...(this.cfg.modelId ? { authorization_model_id: this.cfg.modelId } : {}),
        }),
      });
      if (!res.ok) return [];
      const json = (await res.json().catch(() => ({}))) as { objects?: string[] };
      return json.objects ?? [];
    } catch {
      return [];
    }
  }
}
