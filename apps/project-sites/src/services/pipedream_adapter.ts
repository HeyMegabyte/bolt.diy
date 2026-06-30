/**
 * Pipedream Connect Runtime Adapter.
 *
 * Called ONLY by the Capability Router after native AND Composio options
 * are unavailable. Pipedream is execution-only for long-tail APIs,
 * workflows, triggers, and custom requests.
 *
 * Never the canonical OAuth owner. Routes requiring Pipedream-owned
 * managed auth are flagged and blocked by default.
 *
 * @module services/pipedream_adapter
 * @packageDocumentation
 */

import type {
  CapabilityExecutionResult,
  CapabilityRequest,
  OAuthConnection,
  OAuthProvider,
} from './oauth_connections.js';
import type { ProjectSitesNangoClient } from './nango_client.js';

export interface PipedreamConnectRuntimeAdapter {
  supports(input: { provider: OAuthProvider; action: string }): Promise<boolean>;
  execute<T = unknown>(
    request: CapabilityRequest,
    context: { connection: OAuthConnection; nango: ProjectSitesNangoClient },
  ): Promise<CapabilityExecutionResult<T>>;
}

/**
 * Static v1 registry of Pipedream-supported actions — long-tail APIs
 * not covered by native adapters or Composio.
 */
const PIPEDREAM_ACTIONS: Record<string, string[]> = {
  // Long-tail / custom requests through Pipedream Connect
  airtable: ['airtable.create_record', 'airtable.list_records'],
  notion: ['notion.create_page', 'notion.search_pages'],
  salesforce: ['salesforce.create_lead'],
};

async function checkPipedreamSupport(
  provider: OAuthProvider,
  action: string,
): Promise<{ supported: boolean; requiresExternalAuth: boolean }> {
  const actions = PIPEDREAM_ACTIONS[provider];
  if (actions?.includes(action)) {
    return { supported: true, requiresExternalAuth: false };
  }
  return { supported: false, requiresExternalAuth: false };
}

export function createPipedreamAdapter(): PipedreamConnectRuntimeAdapter {
  return {
    async supports(input) {
      const check = await checkPipedreamSupport(input.provider, input.action);
      return check.supported;
    },

    async execute<T = unknown>(
      request: CapabilityRequest,
      context: { connection: OAuthConnection; nango: ProjectSitesNangoClient },
    ): Promise<CapabilityExecutionResult<T>> {
      const check = await checkPipedreamSupport(request.provider, request.action);

      if (!check.supported) {
        return {
          runtime: 'pipedream', provider: request.provider, action: request.action,
          success: false,
          error: { code: 'UNSUPPORTED_ACTION', message: `Pipedream does not support ${request.provider}/${request.action}` },
        };
      }

      if (check.requiresExternalAuth) {
        return {
          runtime: 'pipedream', provider: request.provider, action: request.action,
          success: false,
          error: {
            code: 'EXTERNAL_AUTH_REQUIRED',
            message: 'This route cannot use the canonical ProjectSites Nango OAuth connection.',
            requiresExternalAuth: true,
          },
        };
      }

      try {
        const result = await context.nango.proxyRequest<unknown>({
          providerConfigKey: context.connection.nangoProviderConfigKey,
          nangoConnectionId: context.connection.nangoConnectionId,
          method: 'POST',
          endpoint: `/pipedream/${request.provider}/${request.action}`,
          body: request.input as Record<string, unknown>,
        });

        return {
          runtime: 'pipedream', provider: request.provider, action: request.action,
          success: true, data: result as T,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        const reauth = msg.includes('401') || msg.includes('auth');
        return {
          runtime: 'pipedream', provider: request.provider, action: request.action,
          success: false,
          error: { code: reauth ? 'REAUTH_REQUIRED' : 'EXECUTION_FAILED', message: msg.slice(0, 500), reauthRequired: reauth },
        };
      }
    },
  };
}

export const noopPipedreamAdapter: PipedreamConnectRuntimeAdapter = {
  supports: async () => false,
  execute: async (request) => ({
    runtime: 'pipedream', provider: request.provider, action: request.action,
    success: false,
    error: { code: 'UNSUPPORTED_ACTION', message: 'Pipedream not configured' },
  }),
};
