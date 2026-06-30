import { z } from 'zod';
import type {
  CapabilityExecutionResult,
  CapabilityRequest,
  OAuthConnection,
} from '../oauth_connections.js';
import type { ProjectSitesNangoClient } from '../nango_client.js';

const CreateIssueInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1).max(256),
  body: z.string().max(65536).optional(),
});

export const githubAdapter = {
  provider: 'github' as const,
  supports(action: string): boolean {
    return action === 'github.create_issue';
  },
  requiredScopes(): string[] {
    return ['repo'];
  },
  async execute<T = unknown>(
    request: CapabilityRequest,
    context: { connection: OAuthConnection; nango: ProjectSitesNangoClient },
  ): Promise<CapabilityExecutionResult<T>> {
    try {
      const parsed = CreateIssueInput.safeParse(request.input);
      if (!parsed.success)
        return {
          runtime: 'native',
          provider: 'github',
          action: request.action,
          success: false,
          error: { code: 'INVALID_INPUT', message: parsed.error.message },
        };
      const result = await context.nango.proxyRequest<{ html_url: string; number: number }>({
        providerConfigKey: context.connection.nangoProviderConfigKey,
        nangoConnectionId: context.connection.nangoConnectionId,
        method: 'POST',
        endpoint: `/repos/${parsed.data.owner}/${parsed.data.repo}/issues`,
        body: { title: parsed.data.title, body: parsed.data.body },
      });
      return {
        runtime: 'native',
        provider: 'github',
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
        provider: 'github',
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
