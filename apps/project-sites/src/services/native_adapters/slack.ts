import { z } from 'zod';
import type { CapabilityExecutionResult, CapabilityRequest, OAuthConnection } from '../oauth_connections.js';
import type { ProjectSitesNangoClient } from '../nango_client.js';

const SendMessageInput = z.object({ channel: z.string().min(1).max(80), text: z.string().min(1).max(40_000) });

export const slackAdapter = {
  provider: 'slack' as const,
  supports(action: string): boolean { return action === 'slack.send_message'; },
  requiredScopes(): string[] { return ['chat:write']; },
  async execute<T = unknown>(request: CapabilityRequest, context: { connection: OAuthConnection; nango: ProjectSitesNangoClient }): Promise<CapabilityExecutionResult<T>> {
    try {
      const parsed = SendMessageInput.safeParse(request.input);
      if (!parsed.success) return { runtime: 'native', provider: 'slack', action: request.action, success: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
      const result = await context.nango.proxyRequest<{ ok: boolean; ts: string }>({
        providerConfigKey: context.connection.nangoProviderConfigKey, nangoConnectionId: context.connection.nangoConnectionId,
        method: 'POST', endpoint: '/api/chat.postMessage', body: parsed.data,
      });
      return { runtime: 'native', provider: 'slack', action: request.action, success: true, data: result as unknown as T };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const reauth = msg.includes('401') || msg.includes('auth') || msg.includes('NANGO_PROXY_AUTH_FAILURE');
      return { runtime: 'native', provider: 'slack', action: request.action, success: false, error: { code: reauth ? 'REAUTH_REQUIRED' : 'EXECUTION_FAILED', message: msg.slice(0, 500), reauthRequired: reauth } };
    }
  },
};
