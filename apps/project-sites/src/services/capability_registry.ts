/**
 * Version-controlled Capability Registry.
 *
 * Maps every provider action through the priority chain:
 * native → composio → pipedream.
 *
 * Never use scattered hardcoded conditionals for capability support.
 * All MCP tools route through this registry.
 *
 * @module services/capability_registry
 * @packageDocumentation
 */

import type { OAuthProvider, CapabilityRegistryEntry } from './oauth_connections.js';

export const TOOL_CAPABILITY_REGISTRY: Record<string, Record<string, CapabilityRegistryEntry>> = {
  google: {
    'gmail.send_email': {
      preferred: 'native',
      fallbacks: ['composio', 'pipedream'],
      requiredScopes: ['https://www.googleapis.com/auth/gmail.send'],
      meteringUnit: 'gmail_email_sent',
    },
    'gmail.search_threads': {
      preferred: 'native',
      fallbacks: ['composio', 'pipedream'],
      requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      meteringUnit: 'gmail_search',
    },
    'calendar.create_event': {
      preferred: 'native',
      fallbacks: ['composio', 'pipedream'],
      requiredScopes: ['https://www.googleapis.com/auth/calendar.events'],
      meteringUnit: 'calendar_event_created',
    },
    'calendar.check_availability': {
      preferred: 'native',
      fallbacks: ['composio', 'pipedream'],
      requiredScopes: ['https://www.googleapis.com/auth/calendar.freebusy'],
      meteringUnit: 'calendar_freebusy_check',
    },
    'drive.find_file': {
      preferred: 'native',
      fallbacks: ['composio', 'pipedream'],
      requiredScopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
      meteringUnit: 'drive_file_search',
    },
  },
  slack: {
    'slack.send_message': {
      preferred: 'native',
      fallbacks: ['composio', 'pipedream'],
      requiredScopes: ['chat:write'],
      meteringUnit: 'slack_message_sent',
    },
  },
  github: {
    'github.create_issue': {
      preferred: 'native',
      fallbacks: ['composio', 'pipedream'],
      requiredScopes: ['repo'],
      meteringUnit: 'github_issue_created',
    },
  },
  hubspot: {
    'hubspot.create_contact': {
      preferred: 'native',
      fallbacks: ['composio', 'pipedream'],
      requiredScopes: ['crm.objects.contacts.write'],
      meteringUnit: 'hubspot_contact_created',
    },
  },
  notion: {
    'notion.create_page': {
      preferred: 'composio',
      fallbacks: ['pipedream'],
      requiredScopes: [],
      meteringUnit: 'notion_page_created',
    },
  },
  airtable: {
    'airtable.create_record': {
      preferred: 'composio',
      fallbacks: ['pipedream'],
      requiredScopes: [],
      meteringUnit: 'airtable_record_created',
    },
  },
} as const;

/**
 * Look up a capability entry. Returns `null` when unknown.
 */
export function getCapabilityEntry(
  provider: OAuthProvider,
  action: string,
): CapabilityRegistryEntry | null {
  const providerEntry = TOOL_CAPABILITY_REGISTRY[provider];
  if (!providerEntry) return null;
  return (providerEntry as Record<string, CapabilityRegistryEntry>)[action] ?? null;
}

/**
 * List every capability for a provider.
 */
export function listProviderCapabilities(provider: OAuthProvider): string[] {
  const providerEntry = TOOL_CAPABILITY_REGISTRY[provider];
  if (!providerEntry) return [];
  return Object.keys(providerEntry);
}

/**
 * All known provider→capability pairs, flattened.
 */
export function listAllCapabilities(): Array<{
  provider: OAuthProvider;
  action: string;
  entry: CapabilityRegistryEntry;
}> {
  const result: Array<{ provider: OAuthProvider; action: string; entry: CapabilityRegistryEntry }> =
    [];
  for (const [provider, actions] of Object.entries(TOOL_CAPABILITY_REGISTRY)) {
    for (const [action, entry] of Object.entries(actions)) {
      result.push({ provider: provider as OAuthProvider, action, entry });
    }
  }
  return result;
}
