import { z } from 'zod';
import type {
  CapabilityExecutionResult,
  CapabilityRequest,
  OAuthConnection,
} from '../oauth_connections.js';
import type { ProjectSitesNangoClient } from '../nango_client.js';

const FindFileInput = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(100).default(10),
});

export const googleDriveAdapter = {
  provider: 'google' as const,
  supports(action: string): boolean {
    return action === 'drive.find_file';
  },
  requiredScopes(): string[] {
    return ['https://www.googleapis.com/auth/drive.metadata.readonly'];
  },
  async execute<T = unknown>(
    request: CapabilityRequest,
    context: { connection: OAuthConnection; nango: ProjectSitesNangoClient },
  ): Promise<CapabilityExecutionResult<T>> {
    try {
      const parsed = FindFileInput.safeParse(request.input);
      if (!parsed.success)
        return {
          runtime: 'native',
          provider: 'google',
          action: request.action,
          success: false,
          error: { code: 'INVALID_INPUT', message: parsed.error.message },
        };
      const result = await context.nango.proxyRequest<{
        files: Array<{ id: string; name: string }>;
      }>({
        providerConfigKey: context.connection.nangoProviderConfigKey,
        nangoConnectionId: context.connection.nangoConnectionId,
        method: 'GET',
        endpoint: '/drive/v3/files',
        query: { q: `name contains '${parsed.data.query}'`, pageSize: parsed.data.maxResults },
      });
      return {
        runtime: 'native',
        provider: 'google',
        action: request.action,
        success: true,
        data: result as unknown as T,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const reauth =
        msg.includes('401') || msg.includes('auth') || msg.includes('NANGO_PROXY_AUTH_FAILURE');
      return {
        runtime: 'native',
        provider: 'google',
        action: request.action,
        success: false,
        error: {
          code: reauth ? 'REAUTH_REQUIRED' : 'EXECUTION_FAILED',
          message: msg.slice(0, 500),
          reauthRequired: reauth,
        },
      };
    }
  },
};
