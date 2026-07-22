/**
 * ProjectSites Nango Client — canonical wrapper for self-hosted Nango at
 * integrations.projectsites.dev.
 *
 * All direct Nango calls go through this wrapper. Never scatter Nango SDK/API
 * usage around the codebase.
 *
 * @module services/nango_client
 * @packageDocumentation
 */

import type { OAuthProvider } from './oauth_connections.js';

/** Canonical self-hosted Nango base URL. */
const NANGO_BASE_URL = 'https://integrations.projectsites.dev';

/**
 * Thin typed client for the self-hosted Nango Auth/Proxy layer.
 *
 * @remarks
 * Nango runs on Fly.io behind the `integrations-proxy` CF Worker at
 * `integrations.projectsites.dev`. All calls go through that proxy —
 * never call `projectsites-nango.fly.dev` directly from application code.
 */
export interface ProjectSitesNangoClient {
  createConnectSession(input: {
    provider: OAuthProvider;
    orgId: string;
    siteId?: string;
    userId: string;
    requiredScopes: string[];
  }): Promise<{
    connectUrl: string;
    nangoConnectionId: string;
    providerConfigKey: string;
  }>;

  getConnection(input: { providerConfigKey: string; nangoConnectionId: string }): Promise<{
    providerAccountId?: string;
    providerAccountEmail?: string;
    scopes: string[];
    status: 'active' | 'expired' | 'revoked' | 'unknown';
  }>;

  proxyRequest<TResponse>(input: {
    providerConfigKey: string;
    nangoConnectionId: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    endpoint: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<TResponse>;

  revokeConnection(input: { providerConfigKey: string; nangoConnectionId: string }): Promise<void>;
}

/**
 * Map ProjectSites OAuthProvider → Nango provider config key.
 */
export function nangoConfigKey(provider: OAuthProvider): string {
  // Nango config keys are lowercase alphanumeric; mirrors the
  // provider name for all currently supported providers.
  return provider;
}

/**
 * Build the create-connect-session payload for Nango's API.
 */
function buildNangoConnectPayload(input: {
  provider: OAuthProvider;
  orgId: string;
  siteId?: string;
  userId: string;
  requiredScopes: string[];
}): Record<string, unknown> {
  return {
    provider_config_key: nangoConfigKey(input.provider),
    end_user: {
      id: input.userId,
      email: '', // populated by Nango from the provider
      display_name: `org:${input.orgId}${input.siteId ? ` site:${input.siteId}` : ''}`,
    },
    oauth_scopes: input.requiredScopes.join(','),
    metadata: {
      orgId: input.orgId,
      siteId: input.siteId ?? null,
      userId: input.userId,
    },
  };
}

/**
 * Production Nango client backed by the Fly-hosted Nango instance.
 */
export function createNangoClient(nangoSecretKey: string): ProjectSitesNangoClient {
  const authHeaders = {
    Authorization: `Bearer ${nangoSecretKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async createConnectSession(input) {
      const body = buildNangoConnectPayload(input);
      const res = await fetch(`${NANGO_BASE_URL}/connect/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => 'unknown');
        throw new Error(`Nango createConnectSession failed: ${res.status} ${err.slice(0, 200)}`);
      }
      const json = (await res.json()) as {
        data: { id: string; token: string };
      };
      return {
        connectUrl: `${NANGO_BASE_URL}/connect/${json.data.token}`,
        nangoConnectionId: json.data.id,
        providerConfigKey: nangoConfigKey(input.provider),
      };
    },

    async getConnection(input) {
      const res = await fetch(
        `${NANGO_BASE_URL}/connection/${input.providerConfigKey}/${input.nangoConnectionId}`,
        { headers: authHeaders },
      );
      if (!res.ok) throw new Error(`Nango getConnection failed: ${res.status}`);
      const json = (await res.json()) as {
        data: {
          provider_config_key: string;
          connection_id: string;
          end_user_id?: string;
          credentials?: { type: string; access_token?: string };
        };
      };
      return {
        providerAccountId: json.data.end_user_id,
        scopes: [],
        status: 'active',
      };
    },

    // @ts-expect-error legacy proxy method — typed wrapper below
    async proxyRequest<TResponse>(input) {
      const url = new URL(
        `${NANGO_BASE_URL}/proxy/${input.providerConfigKey}/${input.nangoConnectionId}${input.endpoint}`,
      );
      if (input.query) {
        for (const [k, v] of Object.entries(input.query)) {
          if (v !== undefined) url.searchParams.set(k, String(v));
        }
      }
      const res = await fetch(url.toString(), {
        method: input.method,
        headers: { ...authHeaders, ...(input.headers ?? {}) },
        body: input.body ? JSON.stringify(input.body) : undefined,
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw Object.assign(new Error('Nango proxy auth failure'), {
            code: 'NANGO_PROXY_AUTH_FAILURE',
            status: res.status,
            body: err,
          });
        }
        throw new Error(`Nango proxy request failed: ${res.status}`);
      }
      return (await res.json()) as TResponse;
    },

    async revokeConnection(input) {
      const res = await fetch(
        `${NANGO_BASE_URL}/connection/${input.providerConfigKey}/${input.nangoConnectionId}`,
        { method: 'DELETE', headers: authHeaders },
      );
      if (!res.ok) throw new Error(`Nango revokeConnection failed: ${res.status}`);
    },
  };
}

/** No-op client for when Nango is not configured. Fails every method. */
export function createNoopNangoClient(): ProjectSitesNangoClient {
  const noop = (): never => {
    throw new Error('Nango is not configured — set NANGO_SECRET_KEY');
  };
  return {
    createConnectSession: noop,
    getConnection: noop,
    proxyRequest: noop,
    revokeConnection: noop,
  };
}
