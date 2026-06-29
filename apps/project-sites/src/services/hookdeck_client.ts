/**
 * Hookdeck client — typed connection + destination builders for webhook routing.
 *
 * @remarks
 * Pure data-transform functions with zero I/O. Build connections and destinations
 * for routing inbound webhooks through Hookdeck to internal services (Plane,
 * Twenty, Listmonk, psnotify, etc.). No fetchImpl needed — all operations are
 * synchronous and side-effect-free.
 *
 * @example
 * ```ts
 * const conn = buildConnection(
 *   'src_plane_webhook',
 *   'dest_plane',
 *   [{ field: 'source', operator: 'IS', value: 'github:plane' }],
 * );
 * // => { id: '…', source: 'src_plane_webhook', destination: 'dest_plane', rules: […] }
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A Hookdeck connection linking a source to a destination with optional
 * filtering rules.
 *
 * @remarks
 * Connections determine how webhook events flow from a source (an inbound
 * endpoint) to a destination (an outbound target). Rules filter which events
 * are forwarded — only events whose payload matches ALL rules pass through.
 *
 * @example
 * ```ts
 * HookdeckConnection = {
 *   id: 'conn_abc123',
 *   source: 'src_plane_webhook',
 *   destination: 'dest_plane',
 *   rules: [{ field: 'source', operator: 'IS', value: 'github:plane' }],
 * }
 * ```
 */
export interface HookdeckConnection {
  /** Hookdeck connection ID (auto-generated or provided). */
  id: string;
  /** Source name/key that identifies the inbound webhook endpoint. */
  source: string;
  /** Destination name/key that identifies the outbound service target. */
  destination: string;
  /**
   * Zero or more filter rules. An event must match ALL rules to be forwarded.
   * An empty array means all events from this source are forwarded.
   */
  rules: HookdeckConnectionRule[];
}

/**
 * A single filter rule on a Hookdeck connection.
 *
 * @example
 * ```ts
 * { field: 'source', operator: 'IS', value: 'stripe' }
 * { field: 'headers.x-event', operator: 'CONTAINS', value: 'issue' }
 * ```
 */
export interface HookdeckConnectionRule {
  /** The event field (or header path) to inspect. */
  field: string;
  /** Comparison operator — exact match (IS), substring (CONTAINS), etc. */
  operator: 'IS' | 'IS_NOT' | 'CONTAINS' | 'NOT_CONTAINS' | 'MATCHES';
  /** Expected value for the rule to match. */
  value: string;
}

/**
 * A Hookdeck destination representing an outbound webhook target.
 *
 * @example
 * ```ts
 * HookdeckDestination = {
 *   id: 'dest_plane',
 *   name: 'Plane Project Management',
 *   url: 'https://plane.megabyte.space/api/webhooks',
 *   method: 'POST',
 *   authType: 'bearer',
 * }
 * ```
 */
export interface HookdeckDestination {
  /** Hookdeck destination ID (auto-generated or provided). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Target URL for webhook delivery. */
  url: string;
  /** HTTP method for delivery. */
  method: 'POST' | 'PUT';
  /** Authentication strategy for the target. */
  authType: 'none' | 'bearer' | 'api_key';
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build a {@link HookdeckConnection} from a source-destination pair with
 * optional filter rules.
 *
 * @remarks
 * Generates an id as `conn_{source}_{destination}`. When `rules` is omitted,
 * an empty rules array is returned (pass-all).
 *
 * @param source - Source name/key identifying the inbound endpoint.
 * @param destination - Destination name/key identifying the outbound target.
 * @param rules - Optional filter rules (defaults to empty pass-all array).
 * @returns A fully-formed {@link HookdeckConnection}.
 *
 * @example
 * ```ts
 * const c = buildConnection('src_github', 'dest_plane');
 * // => { id: 'conn_src_github_dest_plane', source: 'src_github',
 * //      destination: 'dest_plane', rules: [] }
 *
 * const c2 = buildConnection('src_stripe', 'dest_twenty', [
 *   { field: 'type', operator: 'IS', value: 'invoice.paid' },
 * ]);
 * // => { id: 'conn_src_stripe_dest_twenty', source: 'src_stripe',
 * //      destination: 'dest_twenty', rules: […] }
 * ```
 */
export function buildConnection(
  source: string,
  destination: string,
  rules?: HookdeckConnection['rules'],
): HookdeckConnection {
  return {
    destination,
    id: `conn_${source}_${destination}`,
    rules: rules ?? [],
    source,
  };
}

/**
 * Build a {@link HookdeckDestination} for a service target.
 *
 * @remarks
 * Defaults to `POST` and `bearer` auth when method and authType are omitted.
 *
 * @param name - Human-readable display name.
 * @param url - Target delivery URL.
 * @param method - HTTP method (defaults to `'POST'`).
 * @param authType - Authentication strategy (defaults to `'bearer'`).
 * @returns A fully-formed {@link HookdeckDestination}.
 *
 * @example
 * ```ts
 * const d = buildDestination('Plane PM', 'https://plane.megabyte.space/api/webhooks');
 * // => { id: 'dest_plane_pm', name: 'Plane PM',
 * //      url: 'https://plane.megabyte.space/api/webhooks',
 * //      method: 'POST', authType: 'bearer' }
 *
 * const d2 = buildDestination('Public Webhook', 'https://example.com/hook', 'PUT', 'none');
 * // => { id: 'dest_public_webhook', … }
 * ```
 */
export function buildDestination(
  name: string,
  url: string,
  method: 'POST' | 'PUT' = 'POST',
  authType: 'none' | 'bearer' | 'api_key' = 'bearer',
): HookdeckDestination {
  return {
    authType,
    id: `dest_${name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')}`,
    method,
    name,
    url,
  };
}

// ---------------------------------------------------------------------------
// Pre-built destination templates
// ---------------------------------------------------------------------------

/**
 * Pre-built Hookdeck destinations for known internal services.
 *
 * @remarks
 * Each entry maps a service key to a {@link HookdeckDestination} with
 * production URLs and the correct auth/method defaults. Consumers override
 * fields as needed (e.g. swapping the URL for a staging instance).
 *
 * Supported keys: `plane`, `twenty`, `listmonk`, `psnotify`.
 *
 * @example
 * ```ts
 * DESTINATION_TEMPLATES.plane.url
 * // => 'https://plane.megabyte.space/api/webhooks'
 *
 * DESTINATION_TEMPLATES.psnotify.authType
 * // => 'bearer'
 * ```
 */
export const DESTINATION_TEMPLATES: Record<string, HookdeckDestination> = {
  /** Listmonk mailing list webhook target. */
  listmonk: buildDestination('Listmonk', 'https://mail.projectsites.dev/api/webhooks'),
  /** Plane project management webhook target. */
  plane: buildDestination('Plane PM', 'https://plane.megabyte.space/api/webhooks'),
  /** psnotify notification service webhook target. */
  psnotify: buildDestination('psnotify', 'https://notify.projectsites.dev/api/webhooks'),
  /** Twenty CRM webhook target. */
  twenty: buildDestination('Twenty CRM', 'https://crm.projectsites.dev/api/webhooks'),
};
