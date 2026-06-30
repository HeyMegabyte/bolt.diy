/**
 * Native provider adapters — core capabilities ProjectSites deeply owns.
 *
 * Each adapter validates input with Zod, uses the Nango proxy wrapper
 * to call the provider API, returns sanitized output, and maps provider
 * errors to ProjectSites errors with reauth handling.
 *
 * @module services/native_adapters
 * @packageDocumentation
 */

import type { OAuthProvider, CapabilityExecutionResult, CapabilityRequest, OAuthConnection } from '../oauth_connections.js';
import type { ProjectSitesNangoClient } from '../nango_client.js';
import { googleGmailAdapter } from './google_gmail.js';
import { googleCalendarAdapter } from './google_calendar.js';
import { googleDriveAdapter } from './google_drive.js';
import { slackAdapter } from './slack.js';
import { githubAdapter } from './github.js';
import { hubspotAdapter } from './hubspot.js';

export interface NativeProviderAdapter {
  provider: OAuthProvider;
  supports(action: string): boolean;
  requiredScopes(action: string): string[];
  execute<T = unknown>(
    request: CapabilityRequest,
    context: { connection: OAuthConnection; nango: ProjectSitesNangoClient },
  ): Promise<CapabilityExecutionResult<T>>;
}

/** All registered native adapters, keyed by provider. */
const NATIVE_ADAPTERS: Record<string, NativeProviderAdapter[]> = {
  google: [googleGmailAdapter, googleCalendarAdapter, googleDriveAdapter],
  slack: [slackAdapter],
  github: [githubAdapter],
  hubspot: [hubspotAdapter],
};

/** Find the native adapter that handles a given provider+action. */
export function findNativeAdapter(
  provider: OAuthProvider,
  action: string,
): NativeProviderAdapter | null {
  const adapters = NATIVE_ADAPTERS[provider];
  if (!adapters) return null;
  return adapters.find((a) => a.supports(action)) ?? null;
}

/** List all native adapters (for tests). */
export function listNativeAdapters(): Array<{ provider: OAuthProvider; actions: string[] }> {
  const result: Array<{ provider: OAuthProvider; actions: string[] }> = [];
  for (const [provider, adapters] of Object.entries(NATIVE_ADAPTERS)) {
    const actions = adapters.flatMap((a) => {
      // Probe common actions
      const all = ['gmail.send_email', 'gmail.search_threads', 'calendar.create_event', 'calendar.check_availability', 'drive.find_file', 'slack.send_message', 'github.create_issue', 'hubspot.create_contact'];
      return all.filter((act) => a.supports(act));
    });
    result.push({ provider: provider as OAuthProvider, actions });
  }
  return result;
}
