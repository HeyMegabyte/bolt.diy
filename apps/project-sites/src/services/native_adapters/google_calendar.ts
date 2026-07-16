import { z } from 'zod';
import type {
  CapabilityExecutionResult,
  CapabilityRequest,
  OAuthConnection,
} from '../oauth_connections.js';
import type { ProjectSitesNangoClient } from '../nango_client.js';

const CreateEventInput = z.object({
  summary: z.string().min(1).max(500),
  start: z.string(),
  end: z.string(),
  attendees: z.array(z.string().email()).optional(),
});

const CheckAvailabilityInput = z.object({
  timeMin: z.string(),
  timeMax: z.string(),
});

export const googleCalendarAdapter = {
  provider: 'google' as const,

  supports(action: string): boolean {
    return ['calendar.create_event', 'calendar.check_availability'].includes(action);
  },

  requiredScopes(action: string): string[] {
    if (action === 'calendar.create_event')
      return ['https://www.googleapis.com/auth/calendar.events'];
    return ['https://www.googleapis.com/auth/calendar.freebusy'];
  },

  async execute<T = unknown>(
    request: CapabilityRequest,
    context: { connection: OAuthConnection; nango: ProjectSitesNangoClient },
  ): Promise<CapabilityExecutionResult<T>> {
    try {
      const { nangoProviderConfigKey: providerConfigKey, nangoConnectionId } = context.connection;

      if (request.action === 'calendar.create_event') {
        const parsed = CreateEventInput.safeParse(request.input);
        if (!parsed.success)
          return {
            runtime: 'native',
            provider: 'google',
            action: request.action,
            success: false,
            error: { code: 'INVALID_INPUT', message: parsed.error.message },
          };

        const result = await context.nango.proxyRequest<{ id: string }>({
          providerConfigKey,
          nangoConnectionId,
          method: 'POST',
          endpoint: '/calendar/v3/calendars/primary/events',
          body: {
            summary: parsed.data.summary,
            start: { dateTime: parsed.data.start },
            end: { dateTime: parsed.data.end },
            attendees: parsed.data.attendees?.map((e) => ({ email: e })),
          },
        });
        return {
          runtime: 'native',
          provider: 'google',
          action: request.action,
          success: true,
          data: result as unknown as T,
        };
      }

      if (request.action === 'calendar.check_availability') {
        const parsed = CheckAvailabilityInput.safeParse(request.input);
        if (!parsed.success)
          return {
            runtime: 'native',
            provider: 'google',
            action: request.action,
            success: false,
            error: { code: 'INVALID_INPUT', message: parsed.error.message },
          };

        const result = await context.nango.proxyRequest<{ calendars: Record<string, unknown> }>({
          providerConfigKey,
          nangoConnectionId,
          method: 'POST',
          endpoint: '/calendar/v3/freeBusy',
          body: {
            timeMin: parsed.data.timeMin,
            timeMax: parsed.data.timeMax,
            items: [{ id: 'primary' }],
          },
        });
        return {
          runtime: 'native',
          provider: 'google',
          action: request.action,
          success: true,
          data: result as unknown as T,
        };
      }

      return {
        runtime: 'native',
        provider: 'google',
        action: request.action,
        success: false,
        error: { code: 'UNSUPPORTED_ACTION', message: `Unknown: ${request.action}` },
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
