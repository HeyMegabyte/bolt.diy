/**
 * Google Gmail native adapter.
 *
 * Uses the Nango proxy to call the Gmail API with ProjectSites-owned
 * OAuth connections. Never returns raw tokens.
 *
 * @module services/native_adapters/google_gmail
 * @packageDocumentation
 */

import { z } from 'zod';
import type {
  CapabilityExecutionResult,
  CapabilityRequest,
  OAuthConnection,
} from '../oauth_connections.js';
import type { ProjectSitesNangoClient } from '../nango_client.js';

// ── Input schemas ──────────────────────────────────────────────

const SendEmailInput = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(100_000),
  cc: z.string().email().optional(),
  bcc: z.string().email().optional(),
});

const SearchThreadsInput = z.object({
  query: z.string().min(1).max(5000),
  maxResults: z.number().int().min(1).max(100).default(10),
});

// ── Adapter ────────────────────────────────────────────────────

const SUPPORTED_ACTIONS = ['gmail.send_email', 'gmail.search_threads'] as const;

export const googleGmailAdapter = {
  provider: 'google' as const,

  supports(action: string): boolean {
    return (SUPPORTED_ACTIONS as readonly string[]).includes(action);
  },

  requiredScopes(action: string): string[] {
    if (action === 'gmail.send_email') return ['https://www.googleapis.com/auth/gmail.send'];
    if (action === 'gmail.search_threads') return ['https://www.googleapis.com/auth/gmail.readonly'];
    return [];
  },

  async execute<T = unknown>(
    request: CapabilityRequest,
    context: { connection: OAuthConnection; nango: ProjectSitesNangoClient },
  ): Promise<CapabilityExecutionResult<T>> {
    try {
      if (request.action === 'gmail.send_email') {
        const parsed = SendEmailInput.safeParse(request.input);
        if (!parsed.success) {
          return {
            runtime: 'native',
            provider: 'google',
            action: request.action,
            success: false,
            error: { code: 'INVALID_INPUT', message: parsed.error.message },
          };
        }
        const raw = `From: me\r\nTo: ${parsed.data.to}\r\nSubject: ${parsed.data.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${parsed.data.body}`;
        const encoded = btoa(unescape(encodeURIComponent(raw)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const result = await context.nango.proxyRequest<{ id: string; threadId: string }>({
          providerConfigKey: context.connection.nangoProviderConfigKey,
          nangoConnectionId: context.connection.nangoConnectionId,
          method: 'POST',
          endpoint: '/gmail/v1/users/me/messages/send',
          body: { raw: encoded },
        });

        return {
          runtime: 'native',
          provider: 'google',
          action: request.action,
          success: true,
          data: result as unknown as T,
        };
      }

      if (request.action === 'gmail.search_threads') {
        const parsed = SearchThreadsInput.safeParse(request.input);
        if (!parsed.success) {
          return {
            runtime: 'native',
            provider: 'google',
            action: request.action,
            success: false,
            error: { code: 'INVALID_INPUT', message: parsed.error.message },
          };
        }

        const result = await context.nango.proxyRequest<{
          threads: Array<{ id: string; snippet: string }>;
        }>({
          providerConfigKey: context.connection.nangoProviderConfigKey,
          nangoConnectionId: context.connection.nangoConnectionId,
          method: 'GET',
          endpoint: '/gmail/v1/users/me/threads',
          query: { q: parsed.data.query, maxResults: parsed.data.maxResults },
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
        error: { code: 'UNSUPPORTED_ACTION', message: `Unknown action: ${request.action}` },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const reauthRequired =
        msg.includes('401') || msg.includes('auth') || msg.includes('NANGO_PROXY_AUTH_FAILURE');
      return {
        runtime: 'native',
        provider: 'google',
        action: request.action,
        success: false,
        error: {
          code: reauthRequired ? 'REAUTH_REQUIRED' : 'EXECUTION_FAILED',
          message: msg.slice(0, 500),
          reauthRequired,
        },
      };
    }
  },
};
