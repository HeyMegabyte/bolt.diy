/**
 * Listmonk client — DI'd fetch wrapper for listmonk.megabyte.space.
 *
 * @remarks
 * Every function NEVER throws. All side-effects (network calls) are injected
 * via `fetchImpl` so every branch is unit-testable without any real I/O. The
 * pattern mirrors `turnstile.ts` — config validation returns a typed failure
 * union rather than throwing on missing credentials.
 *
 * @example
 * ```ts
 * const health = await listmonkHealth({ baseUrl: env.LISTMONK_BASE_URL, ... });
 * if (!health.ok && health.reason !== 'not_configured') {
 *   console.warn('listmonk unreachable', health.reason);
 * }
 *
 * const result = await listmonkUpsertSubscriber(cfg, {
 *   email: 'user@example.com',
 *   name: 'Alice',
 *   lists: [1],
 * });
 * if (result.ok) console.warn('subscriber id', result.id);
 * ```
 */

// ---------------------------------------------------------------------------
// Config + result types
// ---------------------------------------------------------------------------

/**
 * Connection credentials for a listmonk instance.
 *
 * @remarks
 * All three fields are required for any network operation. When any field is
 * empty/falsy, functions return `not_configured` without calling `fetchImpl`.
 */
export interface ListmonkConfig {
  /** Base URL of the listmonk instance, e.g. `https://listmonk.megabyte.space`. */
  baseUrl: string;
  /** HTTP Basic auth username (listmonk admin user). */
  apiUser: string;
  /** HTTP Basic auth password / API token. */
  apiToken: string;
}

/** Result of a {@link listmonkHealth} call. */
export type ListmonkHealthResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'unreachable' | 'unhealthy' };

/** Input to {@link listmonkUpsertSubscriber}. */
export interface ListmonkSubscriberInput {
  email: string;
  name: string;
  /** Array of listmonk list IDs the subscriber should be enrolled in. */
  lists: number[];
}

/** Result of a {@link listmonkUpsertSubscriber} call. */
export type ListmonkUpsertResult = { ok: true; id: number } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build a Basic auth header value from `user:token`. */
function basicAuth(user: string, token: string): string {
  return `Basic ${btoa(`${user}:${token}`)}`;
}

/** True when all three required config fields are non-empty strings. */
function isConfigured(cfg: ListmonkConfig): boolean {
  return Boolean(cfg.baseUrl && cfg.apiUser && cfg.apiToken);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Probe the listmonk `/api/health` endpoint.
 *
 * @param cfg - Listmonk connection config.
 * @param fetchImpl - Injected fetch implementation; defaults to global `fetch`.
 * @returns A {@link ListmonkHealthResult} — never throws.
 *
 * @throws Never — all errors are encoded in the result union.
 *
 * @example
 * ```ts
 * const h = await listmonkHealth(cfg);
 * if (h.ok) console.warn('listmonk is healthy');
 * ```
 */
export async function listmonkHealth(
  cfg: ListmonkConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ListmonkHealthResult> {
  if (!isConfigured(cfg)) {
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/health`);
    if (!res.ok) {
      return { ok: false, reason: 'unhealthy' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/**
 * Create or update a subscriber in listmonk.
 *
 * @remarks
 * POSTs to `/api/subscribers` with Basic auth and a JSON body that includes
 * `status:'enabled'`. On a duplicate email listmonk returns 409; the caller
 * should decide whether to treat that as a success or an error — this function
 * returns `ok:false` with the HTTP status code in `reason` for non-2xx.
 *
 * @param cfg - Listmonk connection config.
 * @param input - Subscriber fields to upsert.
 * @param fetchImpl - Injected fetch implementation; defaults to global `fetch`.
 * @returns A {@link ListmonkUpsertResult} — never throws.
 *
 * @throws Never — all errors are encoded in the result union.
 *
 * @example
 * ```ts
 * const r = await listmonkUpsertSubscriber(cfg, {
 *   email: 'user@example.com',
 *   name: 'Alice',
 *   lists: [1, 3],
 * });
 * if (r.ok) console.warn('enrolled as subscriber', r.id);
 * ```
 */
export async function listmonkUpsertSubscriber(
  cfg: ListmonkConfig,
  input: ListmonkSubscriberInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ListmonkUpsertResult> {
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/subscribers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(cfg.apiUser, cfg.apiToken),
      },
      body: JSON.stringify({
        email: input.email,
        name: input.name,
        lists: input.lists,
        status: 'enabled',
      }),
    });

    if (!res.ok) {
      let reason = `http_${res.status}`;
      try {
        const data = (await res.json()) as { message?: string };
        if (data.message) reason = data.message;
      } catch {
        // ignore JSON parse failure — keep the status-based reason
      }
      return { ok: false, reason };
    }

    const data = (await res.json()) as { data?: { id?: number } };
    const id = data?.data?.id ?? 0;
    return { ok: true, id };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

/** Input to {@link listmonkCreateCampaign}. */
export interface ListmonkCampaignInput {
  name: string;
  subject: string;
  /** HTML campaign body. */
  body: string;
  /** Listmonk list IDs to target. */
  lists: number[];
}

/**
 * Create a regular HTML campaign (`POST /api/campaigns`). Never throws.
 *
 * @returns `{ ok: true, id }` with the new campaign id, or `{ ok: false, reason }`.
 * @example
 * const r = await listmonkCreateCampaign(cfg, { name: 'June', subject: 'News', body: '<p>hi</p>', lists: [1] });
 */
export async function listmonkCreateCampaign(
  cfg: ListmonkConfig,
  input: ListmonkCampaignInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ListmonkUpsertResult> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(cfg.apiUser, cfg.apiToken),
      },
      body: JSON.stringify({
        name: input.name,
        subject: input.subject,
        lists: input.lists,
        type: 'regular',
        content_type: 'html',
        body: input.body,
      }),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const data = (await res.json()) as { data?: { id?: number } };
    return { ok: true, id: data?.data?.id ?? 0 };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Start (send) a campaign (`PUT /api/campaigns/{id}/status` → `running`). Never throws.
 *
 * @returns `{ ok: true, id }` echoing the campaign id, or `{ ok: false, reason }`.
 */
export async function listmonkStartCampaign(
  cfg: ListmonkConfig,
  campaignId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ListmonkUpsertResult> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/campaigns/${campaignId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(cfg.apiUser, cfg.apiToken),
      },
      body: JSON.stringify({ status: 'running' }),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return { ok: true, id: campaignId };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Blocklist (unsubscribe) every subscriber matching an email
 * (`PUT /api/subscribers/query/blocklist`). Never throws. Single quotes in the
 * email are escaped to avoid breaking the listmonk SQL-ish query.
 *
 * @returns `{ ok: true }` on success, else `{ ok: false, reason }`.
 */
export async function listmonkUnsubscribe(
  cfg: ListmonkConfig,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    const safe = email.replace(/'/g, "''");
    const res = await fetchImpl(`${cfg.baseUrl}/api/subscribers/query/blocklist`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(cfg.apiUser, cfg.apiToken),
      },
      body: JSON.stringify({ query: `subscribers.email = '${safe}'` }),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
