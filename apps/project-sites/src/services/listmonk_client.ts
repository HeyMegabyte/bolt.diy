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
  // listmonk's `/health` is a PUBLIC liveness endpoint ({"data":true}, no auth) — a
  // health probe needs only the base URL, NOT the admin API token. The authed API at
  // `/api/*` 403s "invalid session" without credentials, so probing `/api/health`
  // mis-reported a LIVE listmonk as unhealthy/unknown. Auth'd ops (upsert/campaign/…)
  // still gate on the full credential set via `isConfigured`; only liveness is relaxed.
  if (!cfg.baseUrl) {
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const res = await fetchImpl(`${cfg.baseUrl}/health`);
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
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
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

// ---------------------------------------------------------------------------
// Transactional send — `POST /api/tx`
// ---------------------------------------------------------------------------

/** Input to {@link listmonkSendTransactional}. */
export interface ListmonkTxInput {
  /** The template ID from the listmonk transactional templates. */
  templateId: number;
  /** Recipient email address. */
  subscriberEmail: string;
  /** Key-value data merged into the template placeholders. */
  data?: Record<string, string>;
}

/** Result of a transactional send. */
export type ListmonkTxResult = { ok: true; messageId: string } | { ok: false; reason: string };

/**
 * Send a transactional email via listmonk's `POST /api/tx`.
 *
 * @remarks
 * Listmonk transactional templates use `{{ variable }}` placeholders; keys from
 * `data` fill those placeholders at send time. This function is idempotent-safe
 * (listmonk does not dedupe — idempotency is the caller's responsibility).
 *
 * @param cfg - Listmonk connection config.
 * @param input - Template ID, recipient email, and optional template data.
 * @param fetchImpl - Injected fetch; defaults to global `fetch`.
 * @returns A {@link ListmonkTxResult} — never throws.
 *
 * @throws Never — all errors are encoded in the result union.
 *
 * @example
 * ```ts
 * const r = await listmonkSendTransactional(cfg, {
 *   templateId: 1,
 *   subscriberEmail: 'user@example.com',
 *   data: { code: 'abc123' },
 * });
 * if (r.ok) console.warn('sent', r.messageId);
 * ```
 */
export async function listmonkSendTransactional(
  cfg: ListmonkConfig,
  input: ListmonkTxInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ListmonkTxResult> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/tx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(cfg.apiUser, cfg.apiToken),
      },
      body: JSON.stringify({
        subscriber_email: input.subscriberEmail,
        template_id: input.templateId,
        ...(input.data ? { data: input.data } : {}),
      }),
    });
    if (!res.ok) {
      let reason = `http_${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) reason = body.message;
      } catch {
        /* keep status-based reason */
      }
      return { ok: false, reason };
    }
    const body = (await res.json()) as { data?: { id?: string }; message?: string };
    const messageId = body?.data?.id ?? body?.message ?? crypto.randomUUID();
    return { ok: true, messageId };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Subscriber lookup — `GET /api/subscribers?query=...`
// ---------------------------------------------------------------------------

/** A resolved listmonk subscriber record. */
export interface ListmonkSubscriber {
  id: number;
  email: string;
  name: string;
  status: string;
  lists: number[];
  attribs: Record<string, unknown>;
}

/** Result of a subscriber lookup. */
export type ListmonkGetSubscriberResult =
  | { ok: true; subscriber: ListmonkSubscriber | null }
  | { ok: false; reason: string };

/**
 * Look up a subscriber by email (`GET /api/subscribers?query=...&limit=1`).
 *
 * @remarks
 * Single quotes in the email are escaped to avoid breaking the listmonk SQL-ish
 * query syntax. Returns `{ ok: true, subscriber: null }` when no match exists
 * (the lookup succeeded, the subscriber just doesn't exist yet).
 *
 * @param cfg - Listmonk connection config.
 * @param email - Subscriber email to look up.
 * @param fetchImpl - Injected fetch; defaults to global `fetch`.
 * @returns A {@link ListmonkGetSubscriberResult} — never throws.
 *
 * @throws Never — all errors are encoded in the result union.
 *
 * @example
 * ```ts
 * const r = await listmonkGetSubscriber(cfg, 'user@example.com');
 * if (r.ok && r.subscriber) console.warn('found', r.subscriber.id);
 * ```
 */
export async function listmonkGetSubscriber(
  cfg: ListmonkConfig,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ListmonkGetSubscriberResult> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    const safe = email.replace(/'/g, "''");
    const url = `${cfg.baseUrl}/api/subscribers?query=subscribers.email%20%3D%20%27${encodeURIComponent(safe)}%27&limit=1`;
    const res = await fetchImpl(url, {
      headers: { Authorization: basicAuth(cfg.apiUser, cfg.apiToken) },
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = (await res.json()) as {
      data?: {
        results?: Array<{
          id: number;
          email: string;
          name: string;
          status: string;
          lists: number[];
          attribs: Record<string, unknown>;
        }>;
      };
    };
    const results = body?.data?.results ?? [];
    if (results.length === 0) return { ok: true, subscriber: null };
    const s = results[0];
    return {
      ok: true,
      subscriber: {
        id: s.id,
        email: s.email,
        name: s.name,
        status: s.status,
        lists: s.lists ?? [],
        attribs: s.attribs ?? {},
      },
    };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Subscriber list management (Fire 4 — marketing surface)
// ---------------------------------------------------------------------------

/** Paginated result of listing subscribers. */
export interface ListmonkSubscriberPage {
  subscribers: ListmonkSubscriber[];
  total: number;
  page: number;
  perPage: number;
}

/** Result of listing subscribers. */
export type ListmonkListSubscribersResult =
  | { ok: true; page: ListmonkSubscriberPage }
  | { ok: false; reason: string };

/**
 * List subscribers with pagination (`GET /api/subscribers?page=N&per_page=N`).
 *
 * @param cfg - Listmonk connection config.
 * @param page - Page number (1-based, default 1).
 * @param perPage - Subscribers per page (default 50, max 100).
 * @param fetchImpl - Injected fetch; defaults to global `fetch`.
 * @returns A {@link ListmonkListSubscribersResult} — never throws.
 */
export async function listmonkListSubscribers(
  cfg: ListmonkConfig,
  page = 1,
  perPage = 50,
  fetchImpl: typeof fetch = fetch,
): Promise<ListmonkListSubscribersResult> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    const url = `${cfg.baseUrl}/api/subscribers?page=${page}&per_page=${perPage}`;
    const res = await fetchImpl(url, {
      headers: { Authorization: basicAuth(cfg.apiUser, cfg.apiToken) },
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = (await res.json()) as {
      data?: {
        results?: Array<{
          id: number;
          email: string;
          name: string;
          status: string;
          lists: number[];
          attribs: Record<string, unknown>;
        }>;
        total?: number;
        page?: number;
        per_page?: number;
      };
    };
    const results = (body?.data?.results ?? []).map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      status: s.status,
      lists: s.lists ?? [],
      attribs: s.attribs ?? {},
    }));
    return {
      ok: true,
      page: {
        subscribers: results,
        total: body?.data?.total ?? results.length,
        page: body?.data?.page ?? page,
        perPage: body?.data?.per_page ?? perPage,
      },
    };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** A listmonk mailing list. */
export interface ListmonkList {
  id: number;
  name: string;
  type: string;
  subscriberCount: number;
}

/** Result of listing mailing lists. */
export type ListmonkGetListsResult =
  | { ok: true; lists: ListmonkList[] }
  | { ok: false; reason: string };

/**
 * List all mailing lists (`GET /api/lists`).
 */
export async function listmonkGetLists(
  cfg: ListmonkConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ListmonkGetListsResult> {
  if (!isConfigured(cfg)) return { ok: false, reason: 'not_configured' };
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/api/lists`, {
      headers: { Authorization: basicAuth(cfg.apiUser, cfg.apiToken) },
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = (await res.json()) as {
      data?: {
        results?: Array<{ id: number; name: string; type: string; subscriber_count: number }>;
      };
    };
    const lists = (body?.data?.results ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      subscriberCount: l.subscriber_count,
    }));
    return { ok: true, lists };
  } catch (err: unknown) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
