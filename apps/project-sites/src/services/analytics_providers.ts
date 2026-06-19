/**
 * HTTP forwarders for the analytics EventDispatcher.
 * Each function POSTs a batch of IncomingEvents to a specific analytics provider.
 * All functions are no-ops when the relevant credentials are absent.
 * Fetch is dependency-injected for testability.
 *
 * @module analytics_providers
 */

import type { IncomingEvent } from './analytics_events.js';
import { toPostHog, toSentry, toGa4, toGtm } from './analytics_events.js';

// ---------------------------------------------------------------------------
// ProviderCreds
// ---------------------------------------------------------------------------

/** Credentials for each analytics provider. All sub-objects are optional. */
export interface ProviderCreds {
  /** PostHog project credentials. */
  posthog?: {
    /** PostHog project API key (pk_live_... or pk_test_...). */
    apiKey: string;
    /** PostHog ingestion host. Defaults to 'https://us.i.posthog.com'. */
    host?: string;
  };
  /** Sentry project credentials. */
  sentry?: {
    /** Sentry Data Source Name URL (https://...@...sentry.io/...). */
    dsn: string;
    /** Optional Sentry auth token for the Store endpoint (rarely needed). */
    authToken?: string;
  };
  /** Google Analytics 4 credentials (Measurement Protocol). */
  ga4?: {
    /** GA4 Measurement ID (G-XXXXXXXXXX). */
    measurementId: string;
    /** GA4 Measurement Protocol API secret. */
    apiSecret: string;
  };
  /** Google Tag Manager server-side endpoint credentials. */
  gtm?: {
    /** Full URL of the GTM server-side container endpoint. */
    endpoint: string;
  };
}

// ---------------------------------------------------------------------------
// Type for injected fetch
// ---------------------------------------------------------------------------

/** Minimal fetch signature accepted as dependency injection. */
type FetchFn = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>;

// ---------------------------------------------------------------------------
// forwardPostHog
// ---------------------------------------------------------------------------

/**
 * Forward a batch of IncomingEvents to PostHog via the `/capture/` endpoint.
 * No-op when `creds.posthog` is absent.
 *
 * @param events - Batch of incoming analytics events to forward.
 * @param creds - Provider credentials. Only `posthog` sub-object is used.
 * @param fetchImpl - Injectable fetch implementation (defaults to global fetch).
 * @returns Resolves when the batch is accepted (2xx) or credentials are absent.
 * @throws {Error} With message `posthog_<status>` on non-2xx HTTP response.
 *
 * @example
 * await forwardPostHog(events, { posthog: { apiKey: 'pk_live_abc123' } });
 */
export async function forwardPostHog(
  events: IncomingEvent[],
  creds: ProviderCreds,
  fetchImpl: FetchFn = fetch as FetchFn,
): Promise<void> {
  if (!creds?.posthog) return;

  const host = creds.posthog.host ?? 'https://us.i.posthog.com';
  const batch = events.map(toPostHog);

  const res = await fetchImpl(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: creds.posthog.apiKey, batch }),
  });

  if (!res.ok) {
    throw new Error(`posthog_${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// forwardSentry
// ---------------------------------------------------------------------------

/**
 * Forward a batch of IncomingEvents to Sentry via the HTTP envelope endpoint.
 * No-op when `creds.sentry` is absent.
 *
 * @param events - Batch of incoming analytics events to forward.
 * @param creds - Provider credentials. Only `sentry` sub-object is used.
 * @param fetchImpl - Injectable fetch implementation (defaults to global fetch).
 * @returns Resolves when the batch is accepted (2xx) or credentials are absent.
 * @throws {Error} With message `sentry_<status>` on non-2xx HTTP response.
 *
 * @example
 * await forwardSentry(events, { sentry: { dsn: 'https://key@o0.ingest.sentry.io/0' } });
 */
export async function forwardSentry(
  events: IncomingEvent[],
  creds: ProviderCreds,
  fetchImpl: FetchFn = fetch as FetchFn,
): Promise<void> {
  if (!creds?.sentry) return;

  // Parse DSN to construct the envelope URL
  // https://<key>@<host>/api/<projectId>/envelope/
  const dsnUrl = new URL(creds.sentry.dsn);
  const projectId = dsnUrl.pathname.replace(/^\//, '');
  const envelopeUrl = `${dsnUrl.protocol}//${dsnUrl.host}/api/${projectId}/envelope/`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-sentry-envelope',
  };
  if (creds.sentry.authToken) {
    headers['Authorization'] = `Sentry ${creds.sentry.authToken}`;
  }

  // Sentry envelope: envelope header + one event item per line-pair
  const envelopeHeader = JSON.stringify({ dsn: creds.sentry.dsn });
  const items = events.map((e) => {
    const payload = toSentry(e);
    const itemHeader = JSON.stringify({ type: 'event' });
    return `${itemHeader}\n${JSON.stringify(payload)}`;
  });

  const body = [envelopeHeader, ...items].join('\n');

  const res = await fetchImpl(envelopeUrl, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    throw new Error(`sentry_${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// forwardGa4
// ---------------------------------------------------------------------------

/**
 * Forward a batch of IncomingEvents to Google Analytics 4 via the
 * Measurement Protocol (`/mp/collect`).
 * No-op when `creds.ga4` is absent.
 *
 * @param events - Batch of incoming analytics events to forward.
 * @param creds - Provider credentials. Only `ga4` sub-object is used.
 * @param fetchImpl - Injectable fetch implementation (defaults to global fetch).
 * @returns Resolves when every event is accepted (2xx) or credentials are absent.
 * @throws {Error} With message `ga4_<status>` on the first non-2xx HTTP response.
 *
 * @example
 * await forwardGa4(events, {
 *   ga4: { measurementId: 'G-EXAMPLE', apiSecret: 'secret123' },
 * });
 */
export async function forwardGa4(
  events: IncomingEvent[],
  creds: ProviderCreds,
  fetchImpl: FetchFn = fetch as FetchFn,
): Promise<void> {
  if (!creds?.ga4) return;

  const { measurementId, apiSecret } = creds.ga4;
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  // GA4 Measurement Protocol allows one request per event; fire sequentially.
  for (const event of events) {
    const payload = toGa4(event, measurementId);

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`ga4_${res.status}`);
    }
  }
}

// ---------------------------------------------------------------------------
// forwardGtm
// ---------------------------------------------------------------------------

/**
 * Forward a batch of IncomingEvents to a GTM server-side container endpoint.
 * No-op when `creds.gtm` is absent.
 *
 * @param events - Batch of incoming analytics events to forward.
 * @param creds - Provider credentials. Only `gtm` sub-object is used.
 * @param fetchImpl - Injectable fetch implementation (defaults to global fetch).
 * @returns Resolves when the batch is accepted (2xx) or credentials are absent.
 * @throws {Error} With message `gtm_<status>` on non-2xx HTTP response.
 *
 * @example
 * await forwardGtm(events, {
 *   gtm: { endpoint: 'https://collect.example.com/gtm' },
 * });
 */
export async function forwardGtm(
  events: IncomingEvent[],
  creds: ProviderCreds,
  fetchImpl: FetchFn = fetch as FetchFn,
): Promise<void> {
  if (!creds?.gtm) return;

  const batch = events.map(toGtm);

  const res = await fetchImpl(creds.gtm.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
  });

  if (!res.ok) {
    throw new Error(`gtm_${res.status}`);
  }
}
