/**
 * Listmonk client — DI'd fetch wrapper for listmonk.megabyte.space.
 *
 * @remarks
 * Every function NEVER throws — all errors are encoded in a typed result union.
 * Network calls are injected via `fetchImpl` so every branch is unit-testable
 * without real I/O. Config validation returns a `not_configured` failure rather
 * than throwing on missing credentials (mirrors `turnstile.ts`).
 */

// ---------------------------------------------------------------------------
// Config + result types
// ---------------------------------------------------------------------------

/**
 * Connection credentials for a listmonk instance.
 *
 * @remarks
 * All three fields are required for any AUTHED network operation. When any is
 * empty/falsy, authed functions return `not_configured` without calling `fetchImpl`.
 */
export interface ListmonkConfig {
  baseUrl: string;
  apiUser: string;
  apiToken: string;
}

export type ListmonkHealthResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'unreachable' | 'unhealthy' };

export interface ListmonkSubscriberInput {
  email: string;
  name: string;
  /** Array of listmonk list IDs the subscriber should be enrolled in. */
  lists: number[];
}

export type ListmonkUpsertResult = { ok: true; id: number } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function basicAuth(user: string, token: string): string {
  return `Basic ${btoa(`${user}:${token}`)}`;
}

function isConfigured(cfg: ListmonkConfig): boolean {
  return Boolean(cfg.baseUrl && cfg.apiUser && cfg.apiToken);
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export async function listmonkHealth(
  cfg: ListmonkConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ListmonkHealthResult> {
  // listmonk's `/health` is a PUBLIC liveness endpoint ({"data":true}, no auth) — a
  // health probe needs only the base URL, NOT the admin API token. The authed API at
  // `/api/*` 403s "invalid session" without credentials, so probing `/api/health`
  // mis-reported a LIVE listmonk as unhealthy/unknown. Authed ops (upsert/campaign/…)
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
 * On a duplicate email listmonk returns 409; this returns `ok:false` with the
 * HTTP status in `reason` for any non-2xx, so the caller decides how to treat it.
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

export interface ListmonkCampaignInput {
  name: string;
  subject: string;
  /** HTML campaign body. */
  body: string;
  /** Listmonk list IDs to target. */
  lists: number[];
}

/** Create a regular HTML campaign (`POST /api/campaigns`). Never throws. */
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

/** Start (send) a campaign (`PUT /api/campaigns/{id}/status` → `running`). Never throws. */
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
 * (`PUT /api/subscribers/query/blocklist`). Never throws.
 *
 * @remarks Single quotes in the email are doubled to avoid breaking the listmonk SQL-ish query.
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

export interface ListmonkTxInput {
  /** The template ID from the listmonk transactional templates. */
  templateId: number;
  subscriberEmail: string;
  /** Key-value data merged into the template `{{ variable }}` placeholders. */
  data?: Record<string, string>;
}

export type ListmonkTxResult = { ok: true; messageId: string } | { ok: false; reason: string };

/**
 * Send a transactional email via listmonk's `POST /api/tx`. Never throws.
 *
 * @remarks
 * listmonk does NOT dedupe — idempotency is the caller's responsibility.
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

export interface ListmonkSubscriber {
  id: number;
  email: string;
  name: string;
  status: string;
  lists: number[];
  attribs: Record<string, unknown>;
}

export type ListmonkGetSubscriberResult =
  | { ok: true; subscriber: ListmonkSubscriber | null }
  | { ok: false; reason: string };

/**
 * Look up a subscriber by email (`GET /api/subscribers?query=...&limit=1`). Never throws.
 *
 * @remarks
 * Single quotes in the email are doubled to avoid breaking the listmonk SQL-ish query.
 * Returns `{ ok: true, subscriber: null }` when no match exists — the lookup
 * succeeded, the subscriber just doesn't exist yet.
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
// Subscriber list management
// ---------------------------------------------------------------------------

export interface ListmonkSubscriberPage {
  subscribers: ListmonkSubscriber[];
  total: number;
  page: number;
  perPage: number;
}

export type ListmonkListSubscribersResult =
  | { ok: true; page: ListmonkSubscriberPage }
  | { ok: false; reason: string };

/**
 * List subscribers with pagination (`GET /api/subscribers?page=N&per_page=N`). Never throws.
 *
 * @param perPage - Subscribers per page (default 50, listmonk caps at 100).
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

export interface ListmonkList {
  id: number;
  name: string;
  type: string;
  subscriberCount: number;
}

export type ListmonkGetListsResult =
  | { ok: true; lists: ListmonkList[] }
  | { ok: false; reason: string };

/** List all mailing lists (`GET /api/lists`). Never throws. */
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
