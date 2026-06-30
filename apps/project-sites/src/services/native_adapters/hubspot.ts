import { z } from 'zod';
import type { CapabilityExecutionResult, CapabilityRequest, OAuthConnection } from '../oauth_connections.js';
import type { ProjectSitesNangoClient } from '../nango_client.js';

const CreateContactInput = z.object({
  email: z.string().email(),
  firstname: z.string().min(1).max(100).optional(),
  lastname: z.string().min(1).max(100).optional(),
});

export const hubspotAdapter = {
  provider: 'hubspot' as const,
  supports(action: string): boolean { return action === 'hubspot.create_contact'; },
  requiredScopes(): string[] { return ['crm.objects.contacts.write']; },
  async execute<T = unknown>(request: CapabilityRequest, context: { connection: OAuthConnection; nango: ProjectSitesNangoClient }): Promise<CapabilityExecutionResult<T>> {
    try {
      const parsed = CreateContactInput.safeParse(request.input);
      if (!parsed.success) return { runtime: 'native', provider: 'hubspot', action: request.action, success: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
      const props: Record<string, string> = { email: parsed.data.email };
      if (parsed.data.firstname) props.firstname = parsed.data.firstname;
      if (parsed.data.lastname) props.lastname = parsed.data.lastname;
      const result = await context.nango.proxyRequest<{ id: string }>({
        providerConfigKey: context.connection.nangoProviderConfigKey, nangoConnectionId: context.connection.nangoConnectionId,
        method: 'POST', endpoint: '/crm/v3/objects/contacts', body: { properties: props },
      });
      return { runtime: 'native', provider: 'hubspot', action: request.action, success: true, data: result as unknown as T };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const reauth = msg.includes('401') || msg.includes('auth') || msg.includes('NANGO_PROXY_AUTH_FAILURE');
      return { runtime: 'native', provider: 'hubspot', action: request.action, success: false, error: { code: reauth ? 'REAUTH_REQUIRED' : 'EXECUTION_FAILED', message: msg.slice(0, 500), reauthRequired: reauth } };
    }
  },
};
