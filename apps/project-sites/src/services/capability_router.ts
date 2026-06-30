/**
 * ProjectSites Capability Router.
 *
 * Receives capability requests from MCP tools, app features, workflows,
 * or internal jobs. Decides execution via:
 *   native → composio → pipedream → unsupported
 *
 * Fails closed when: no connection, revoked, missing scopes, wrong org.
 *
 * @module services/capability_router
 * @packageDocumentation
 */

import type {
  CapabilityRequest,
  CapabilityRouteDecision,
  CapabilityExecutionResult,
  CapabilityRuntime,
  OAuthConnection,
  OAuthProvider,
} from './oauth_connections.js';
import { getCapabilityEntry } from './capability_registry.js';
import { findNativeAdapter } from './native_adapters/index.js';
import {
  createComposioAdapter,
  noopComposioAdapter,
  type ComposioRuntimeAdapter,
} from './composio_adapter.js';
import {
  createPipedreamAdapter,
  noopPipedreamAdapter,
  type PipedreamConnectRuntimeAdapter,
} from './pipedream_adapter.js';
import type { ProjectSitesNangoClient } from './nango_client.js';
import type { Env } from '../types/env.js';

/** Dependencies injected at construction time. */
export interface CapabilityRouterDeps {
  nango: ProjectSitesNangoClient;
  composio: ComposioRuntimeAdapter;
  pipedream: PipedreamConnectRuntimeAdapter;
  /** Fetch an active OAuth connection from D1. */
  getConnection: (orgId: string, provider: OAuthProvider) => Promise<OAuthConnection | null>;
  /** Emit an audit event. Fired via ctx.waitUntil(). */
  emitAudit: (event: Record<string, unknown>) => void;
  /** Emit a metering event. Fired via ctx.waitUntil(). */
  emitMetering: (event: Record<string, unknown>) => void;
}

/** Priority-ordered runtime list. */
const RUNTIME_PRIORITY: CapabilityRuntime[] = ['native', 'composio', 'pipedream'];

/**
 * Determine which runtime to use for a capability request.
 *
 * @remarks
 * Checks in strict priority order: native → composio → pipedream.
 * Returns `null` when no runtime supports the action.
 */
export async function routeCapabilityRequest(
  request: CapabilityRequest,
  deps: CapabilityRouterDeps,
): Promise<{ decision: CapabilityRouteDecision | null; connection: OAuthConnection | null }> {
  // 1. Verify connection exists
  const connection = await deps.getConnection(request.orgId, request.provider);
  if (!connection) {
    return {
      decision: null,
      connection: null,
    };
  }

  if (connection.status !== 'active') {
    return { decision: null, connection };
  }

  // 2. Check required scopes from registry
  const entry = getCapabilityEntry(request.provider, request.action);
  if (entry && entry.requiredScopes.length > 0) {
    const hasAllScopes = entry.requiredScopes.every((s) => connection.scopes.includes(s));
    if (!hasAllScopes) {
      return { decision: null, connection };
    }
  }

  // 3. Try native first
  const nativeAdapter = findNativeAdapter(request.provider, request.action);
  if (nativeAdapter) {
    return {
      connection,
      decision: {
        runtime: 'native',
        provider: request.provider,
        action: request.action,
        reason: `Native adapter available for ${request.provider}/${request.action}`,
        requiresExternalAuth: false,
      },
    };
  }

  // 4. Try Composio
  if (await deps.composio.supports({ provider: request.provider, action: request.action })) {
    return {
      connection,
      decision: {
        runtime: 'composio',
        provider: request.provider,
        action: request.action,
        reason: `Composio supports ${request.provider}/${request.action}; no native adapter`,
        requiresExternalAuth: false,
      },
    };
  }

  // 5. Try Pipedream
  if (await deps.pipedream.supports({ provider: request.provider, action: request.action })) {
    return {
      connection,
      decision: {
        runtime: 'pipedream',
        provider: request.provider,
        action: request.action,
        reason: `Pipedream supports ${request.provider}/${request.action}; native and Composio unavailable`,
        requiresExternalAuth: false,
      },
    };
  }

  return { decision: null, connection };
}

/**
 * Execute a capability through the router.
 *
 * Routes → executes → emits audit + metering → returns sanitized result.
 */
export async function executeCapability<T = unknown>(
  request: CapabilityRequest,
  deps: CapabilityRouterDeps,
): Promise<CapabilityExecutionResult<T>> {
  const start = Date.now();

  const { decision, connection } = await routeCapabilityRequest(request, deps);

  // ── Fail closed ──────────────────────────────────────────
  if (!connection) {
    const result: CapabilityExecutionResult = {
      runtime: 'native',
      provider: request.provider,
      action: request.action,
      success: false,
      error: {
        code: 'NO_CONNECTION',
        message: `No active OAuth connection for ${request.provider}`,
      },
    };
    deps.emitAudit({ ...request, decision: null, success: false, durationMs: Date.now() - start });
    return result;
  }

  if (connection.status !== 'active') {
    const result: CapabilityExecutionResult = {
      runtime: 'native',
      provider: request.provider,
      action: request.action,
      success: false,
      error: {
        code: 'CONNECTION_INACTIVE',
        message: `Connection is ${connection.status}`,
        reauthRequired: connection.status === 'expired' || connection.status === 'revoked',
      },
    };
    deps.emitAudit({
      ...request,
      decision: null,
      status: connection.status,
      success: false,
      durationMs: Date.now() - start,
    });
    return result;
  }

  if (!decision) {
    // Check for missing scopes
    const entry = getCapabilityEntry(request.provider, request.action);
    if (entry && entry.requiredScopes.length > 0) {
      const missing = entry.requiredScopes.filter((s) => !connection.scopes.includes(s));
      if (missing.length > 0) {
        const result: CapabilityExecutionResult = {
          runtime: 'native',
          provider: request.provider,
          action: request.action,
          success: false,
          error: {
            code: 'MISSING_SCOPES',
            message: `Missing scopes: ${missing.join(', ')}`,
            missingScopes: missing,
          },
        };
        deps.emitAudit({
          ...request,
          decision: null,
          missingScopes: missing,
          success: false,
          durationMs: Date.now() - start,
        });
        return result;
      }
    }

    const result: CapabilityExecutionResult = {
      runtime: 'native',
      provider: request.provider,
      action: request.action,
      success: false,
      error: {
        code: 'UNSUPPORTED_CAPABILITY',
        message: `No runtime supports ${request.provider}/${request.action}`,
      },
    };
    deps.emitAudit({ ...request, decision: null, success: false, durationMs: Date.now() - start });
    return result;
  }

  // ── Execute ──────────────────────────────────────────────
  let result: CapabilityExecutionResult<T>;

  if (decision.runtime === 'native') {
    const adapter = findNativeAdapter(request.provider, request.action);
    if (!adapter) {
      result = {
        runtime: 'native',
        provider: request.provider,
        action: request.action,
        success: false,
        error: { code: 'ADAPTER_NOT_FOUND', message: 'Native adapter resolved but not found' },
      };
    } else {
      result = await adapter.execute<T>(request, { connection, nango: deps.nango });
    }
  } else if (decision.runtime === 'composio') {
    result = await deps.composio.execute<T>(request, { connection, nango: deps.nango });
  } else {
    result = await deps.pipedream.execute<T>(request, { connection, nango: deps.nango });
  }

  const durationMs = Date.now() - start;

  // ── Emit audit + metering ───────────────────────────────
  deps.emitAudit({
    orgId: request.orgId,
    siteId: request.siteId,
    userId: request.userId,
    provider: request.provider,
    action: request.action,
    runtime: result.runtime,
    connectionId: connection.id,
    nangoConnectionId: connection.nangoConnectionId,
    success: result.success,
    errorCode: result.error?.code,
    durationMs,
  });

  deps.emitMetering({
    orgId: request.orgId,
    siteId: request.siteId,
    userId: request.userId,
    provider: request.provider,
    action: request.action,
    runtime: result.runtime,
    connectionId: connection.id,
    nangoConnectionId: connection.nangoConnectionId,
    success: result.success,
    errorCode: result.error?.code,
    durationMs,
    usageUnits: 1,
    meteringUnit:
      getCapabilityEntry(request.provider, request.action)?.meteringUnit ?? 'capability_execution',
    createdAt: new Date().toISOString(),
  });

  return result;
}

/**
 * Factory: build a CapabilityRouter wired to the Worker env.
 */
export function createCapabilityRouter(
  env: Env,
  nangoClient: ProjectSitesNangoClient,
): {
  routeCapabilityRequest: typeof routeCapabilityRequest;
  executeCapability: typeof executeCapability;
} {
  const composio = env.COMPOSIO_API_KEY
    ? createComposioAdapter(env as { COMPOSIO_API_KEY?: string })
    : noopComposioAdapter;
  const pipedream = env.PIPEDREAM_CLIENT_ID ? createPipedreamAdapter() : noopPipedreamAdapter;

  const deps: CapabilityRouterDeps = {
    nango: nangoClient,
    composio,
    pipedream,
    getConnection: async (orgId, provider) => {
      const row = await env.DB.prepare(
        `SELECT id, org_id, site_id, provider, display_name, status, scopes_json,
                connected_at, updated_at
           FROM mcp_connections
          WHERE org_id = ? AND provider = ? AND status = 'active'
          ORDER BY connected_at DESC LIMIT 1`,
      )
        .bind(orgId, provider)
        .first<{
          id: string;
          org_id: string;
          site_id: string | null;
          provider: string;
          display_name: string;
          status: string;
          scopes_json: string | null;
          connected_at: string;
          updated_at: string;
        }>();
      if (!row) return null;
      return {
        id: row.id,
        orgId: row.org_id,
        siteId: row.site_id ?? undefined,
        userId: '',
        provider: row.provider as OAuthProvider,
        providerAccountId: '',
        nangoConnectionId: row.id,
        nangoProviderConfigKey: row.provider,
        scopes: row.scopes_json ? (JSON.parse(row.scopes_json) as string[]) : [],
        status: row.status as OAuthConnection['status'],
        createdAt: row.connected_at,
        updatedAt: row.updated_at,
      };
    },
    emitAudit: (event) => {
      // Fire-and-forget via waitUntil in route context
      console.log(JSON.stringify({ level: 'info', msg: 'capability_audit', ...event }));
    },
    emitMetering: (event) => {
      console.log(JSON.stringify({ level: 'info', msg: 'capability_metering', ...event }));
    },
  };

  return {
    routeCapabilityRequest: (req) => routeCapabilityRequest(req, deps),
    executeCapability: (req) => executeCapability(req, deps),
  };
}
