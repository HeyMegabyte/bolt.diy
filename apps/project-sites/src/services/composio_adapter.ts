/**
 * Composio Runtime Adapter.
 *
 * Called ONLY by the Capability Router after native adapters fail to support
 * the action. Composio is execution-only — never the canonical OAuth owner.
 *
 * Routes that require Composio-owned managed auth are flagged and blocked
 * by default.
 *
 * @module services/composio_adapter
 * @packageDocumentation
 */

import type {
  CapabilityExecutionResult,
  CapabilityRequest,
  OAuthConnection,
  OAuthProvider,
} from './oauth_connections.js';
import type { ProjectSitesNangoClient } from './nango_client.js';

/** Composio tool/action support check result. */
interface ComposioSupportCheck {
  supported: boolean;
  requiresExternalAuth: boolean;
  toolName?: string;
}

/**
 * Check whether Composio supports a provider/action.
 *
 * @remarks In v1 this is a static lookup. When a Composio API key is
 * configured, it should query the Composio tools catalog instead.
 */
async function checkComposioSupport(
  provider: OAuthProvider,
  action: string,
  _env?: { COMPOSIO_API_KEY?: string },
): Promise<ComposioSupportCheck> {
  // Static v1 registry — covers common agent-native SaaS tools.
  const COMPOSIO_TOOLS: Record<string, string[]> = {
    notion: ['notion.create_page', 'notion.search_pages', 'notion.update_page'],
    airtable: ['airtable.create_record', 'airtable.list_records', 'airtable.update_record'],
    salesforce: ['salesforce.create_lead', 'salesforce.search_accounts'],
    asana: ['asana.create_task', 'asana.list_projects'],
    trello: ['trello.create_card', 'trello.list_boards'],
  };

  const tools = COMPOSIO_TOOLS[provider];
  if (tools?.includes(action)) {
    return { supported: true, requiresExternalAuth: false, toolName: action };
  }

  return { supported: false, requiresExternalAuth: false };
}

export interface ComposioRuntimeAdapter {
  supports(input: { provider: OAuthProvider; action: string }): Promise<boolean>;
  execute<T = unknown>(
    request: CapabilityRequest,
    context: { connection: OAuthConnection; nango: ProjectSitesNangoClient },
  ): Promise<CapabilityExecutionResult<T>>;
}

export function createComposioAdapter(env?: { COMPOSIO_API_KEY?: string }): ComposioRuntimeAdapter {
  return {
    async supports(input) {
      const check = await checkComposioSupport(input.provider, input.action, env);
      return check.supported && !check.requiresExternalAuth;
    },

    async execute<T = unknown>(
      request: CapabilityRequest,
      context: { connection: OAuthConnection; nango: ProjectSitesNangoClient },
    ): Promise<CapabilityExecutionResult<T>> {
      const check = await checkComposioSupport(request.provider, request.action);

      if (!check.supported) {
        return {
          runtime: 'composio', provider: request.provider, action: request.action,
          success: false,
          error: { code: 'UNSUPPORTED_ACTION', message: `Composio does not support ${request.provider}/${request.action}` },
        };
      }

      if (check.requiresExternalAuth) {
        return {
          runtime: 'composio', provider: request.provider, action: request.action,
          success: false,
          error: {
            code: 'EXTERNAL_AUTH_REQUIRED',
            message: 'This route cannot use the canonical ProjectSites Nango OAuth connection.',
            requiresExternalAuth: true,
          },
        };
      }

      // In v1, Composio execution goes through Nango proxy with the
      // ProjectSites-owned OAuth token. The full Composio SDK integration
      // is deferred until COMPOSIO_API_KEY is provisioned.
      try {
        const result = await context.nango.proxyRequest<unknown>({
          providerConfigKey: context.connection.nangoProviderConfigKey,
          nangoConnectionId: context.connection.nangoConnectionId,
          method: 'POST',
          endpoint: `/composio/${request.provider}/${request.action}`,
          body: request.input as Record<string, unknown>,
        });

        return {
          runtime: 'composio', provider: request.provider, action: request.action,
          success: true, data: result as T,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        const reauth = msg.includes('401') || msg.includes('auth');
        return {
          runtime: 'composio', provider: request.provider, action: request.action,
          success: false,
          error: { code: reauth ? 'REAUTH_REQUIRED' : 'EXECUTION_FAILED', message: msg.slice(0, 500), reauthRequired: reauth },
        };
      }
    },
  };
}

/** No-op adapter when Composio is not configured. */
export const noopComposioAdapter: ComposioRuntimeAdapter = {
  supports: async () => false,
  execute: async (request) => ({
    runtime: 'composio', provider: request.provider, action: request.action,
    success: false,
    error: { code: 'UNSUPPORTED_ACTION', message: 'Composio not configured' },
  }),
};
