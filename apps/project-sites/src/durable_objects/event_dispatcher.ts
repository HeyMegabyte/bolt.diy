/**
 * @module durable_objects/event_dispatcher
 *
 * Per-site Unified Analytics dispatcher (Plane H of `_CONVERGENCE_BACKLOG.md`).
 * One Durable Object instance per `siteId` (`idFromName(siteId)`) → lock-free
 * dedup + ordered batching. It is a THIN shell composing seven already-tested
 * primitives:
 *  - {@link DedupWindow}      — 48h at-least-once dedup
 *  - {@link CircuitBreaker}   — per-provider fail-fast
 *  - {@link dispatchBatch}    — Sentry-first concurrent fan-out
 *  - the `analytics_providers` forwarders (Sentry/PostHog/GA4/GTM)
 *
 * Durability: the queue, dedup snapshot, and breaker snapshots persist to DO
 * storage so nothing is lost across hibernation. Failed batches land in the D1
 * `dead_letter_events` table for the separate DLQ-retry job.
 *
 * Endpoints (internal, reached by the `/api/events` route over the DO binding):
 *  - `POST /enqueue` — body = one validated event → 202 `{status:'queued'|'duplicate'}`
 *  - `GET  /debug`   — `{ siteId, queueDepth, circuits, lastFlushAt, lastOutcomes }`
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import { IncomingEventSchema, type IncomingEvent } from '../services/analytics_events.js';
import { DedupWindow, type DedupEntry } from '../services/event_dedup.js';
import { CircuitBreaker, type CircuitBreakerSnapshot } from '../services/circuit_breaker.js';
import { dispatchBatch, FORWARD_ORDER, type ProviderId } from '../services/event_dispatch.js';
import {
  forwardSentry,
  forwardPostHog,
  forwardGa4,
  forwardGtm,
  type ProviderCreds,
} from '../services/analytics_providers.js';

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5_000;

/** Persisted-state storage keys. */
const KEY_QUEUE = 'queue';
const KEY_DEDUP = 'dedup';
const KEY_SITE = 'siteId';
const KEY_BREAKERS = 'breakers';

export class EventDispatcher extends DurableObject<Env> {
  private queue: IncomingEvent[] = [];
  private dedup = new DedupWindow();
  private breakers = new Map<ProviderId, CircuitBreaker>();
  private siteId = '';
  private lastFlushAt: number | null = null;
  private lastOutcomes: unknown[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Hydrate persisted state before serving any request.
    void ctx.blockConcurrencyWhile(async () => {
      this.queue = (await ctx.storage.get<IncomingEvent[]>(KEY_QUEUE)) ?? [];
      this.siteId = (await ctx.storage.get<string>(KEY_SITE)) ?? '';
      const dedupSnap = (await ctx.storage.get<DedupEntry[]>(KEY_DEDUP)) ?? [];
      this.dedup = DedupWindow.fromSnapshot(dedupSnap);
      const breakerSnaps =
        (await ctx.storage.get<Record<string, CircuitBreakerSnapshot>>(KEY_BREAKERS)) ?? {};
      for (const p of FORWARD_ORDER) {
        if (breakerSnaps[p]) this.breakers.set(p, CircuitBreaker.fromSnapshot(breakerSnaps[p]));
      }
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    if (request.method === 'POST' && url.pathname === '/enqueue') {
      const body = await request.json().catch(() => null);
      const parsed = IncomingEventSchema.safeParse(body);
      if (!parsed.success) {
        return Response.json({ status: 'invalid', error: parsed.error.flatten() }, { status: 400 });
      }
      const event = parsed.data;

      // Optional client sampling: drop above the rate.
      if (
        event.sampleRate !== undefined &&
        event.sampleRate < 1 &&
        hashUnit(event.eventId) > event.sampleRate
      ) {
        return Response.json({ status: 'sampled_out' }, { status: 202 });
      }

      if (!this.dedup.markIfNew(event.eventId, now)) {
        return Response.json({ status: 'duplicate' }, { status: 202 });
      }

      if (!this.siteId) {
        this.siteId = event.siteId;
        await this.ctx.storage.put(KEY_SITE, this.siteId);
      }
      this.queue.push(event);
      await this.ctx.storage.put(KEY_QUEUE, this.queue);
      await this.ctx.storage.put(KEY_DEDUP, this.dedup.snapshot());

      if (this.queue.length >= BATCH_SIZE) {
        await this.flush(now);
      } else if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(now + FLUSH_INTERVAL_MS);
      }
      return Response.json({ status: 'queued' }, { status: 202 });
    }

    if (request.method === 'GET' && url.pathname === '/debug') {
      const circuits: Record<string, string> = {};
      for (const p of FORWARD_ORDER) circuits[p] = this.breakers.get(p)?.peek(now) ?? 'closed';
      return Response.json({
        siteId: this.siteId,
        queueDepth: this.queue.length,
        circuits,
        lastFlushAt: this.lastFlushAt,
        lastOutcomes: this.lastOutcomes,
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    await this.flush(now);
    this.dedup.prune(now);
    await this.ctx.storage.put(KEY_DEDUP, this.dedup.snapshot());
    if (this.queue.length > 0) {
      await this.ctx.storage.setAlarm(now + FLUSH_INTERVAL_MS);
    }
  }

  /** Drain up to BATCH_SIZE events, fan out, persist breakers, DLQ failures. */
  private async flush(now: number): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, BATCH_SIZE);
    this.lastFlushAt = now;

    const creds = await this.loadCreds();
    const ensureBreaker = (p: ProviderId): CircuitBreaker => {
      let b = this.breakers.get(p);
      if (!b) {
        b = new CircuitBreaker();
        this.breakers.set(p, b);
      }
      return b;
    };
    for (const p of FORWARD_ORDER) ensureBreaker(p);

    const forward = async (provider: ProviderId, evs: readonly IncomingEvent[]): Promise<void> => {
      const arr = evs as IncomingEvent[];
      if (provider === 'sentry') return forwardSentry(arr, creds);
      if (provider === 'posthog') return forwardPostHog(arr, creds);
      if (provider === 'ga4') return forwardGa4(arr, creds);
      return forwardGtm(arr, creds);
    };
    const configured = (p: ProviderId): boolean =>
      p === 'sentry'
        ? Boolean(creds.sentry)
        : p === 'posthog'
          ? Boolean(creds.posthog)
          : p === 'ga4'
            ? Boolean(creds.ga4)
            : Boolean(creds.gtm);

    const outcomes = await dispatchBatch(
      batch,
      { forward, breakers: this.breakers, configured },
      now,
    );
    this.lastOutcomes = outcomes;

    // Persist the (possibly drained) queue + breaker snapshots.
    await this.ctx.storage.put(KEY_QUEUE, this.queue);
    const snaps: Record<string, CircuitBreakerSnapshot> = {};
    for (const [p, b] of this.breakers) snaps[p] = b.snapshot();
    await this.ctx.storage.put(KEY_BREAKERS, snaps);

    // Dead-letter the batch for any failed provider (best-effort; never throws).
    const failed = outcomes.filter((o) => o.status === 'failed');
    if (failed.length > 0)
      await this.deadLetter(batch, failed.map((f) => f.provider).join(','), now);
  }

  /** Load per-site provider credentials from D1 (`provider_credentials`). */
  private async loadCreds(): Promise<ProviderCreds> {
    const creds: ProviderCreds = {};
    const db = this.env.DB;
    if (!db || !this.siteId) return creds;
    try {
      const { results } = await db
        .prepare('SELECT provider, apiKey FROM provider_credentials WHERE siteId = ?')
        .bind(this.siteId)
        .all<{ provider: string; apiKey: string }>();
      for (const row of results ?? []) {
        if (row.provider === 'posthog') creds.posthog = { apiKey: row.apiKey };
        else if (row.provider === 'sentry') creds.sentry = { dsn: row.apiKey };
        else if (row.provider === 'gtm') creds.gtm = { endpoint: row.apiKey };
        else if (row.provider === 'ga4') {
          // GA4 needs two values; stored as "measurementId:apiSecret".
          const [measurementId, apiSecret] = row.apiKey.split(':');
          if (measurementId && apiSecret) creds.ga4 = { measurementId, apiSecret };
        }
      }
    } catch (err) {
      console.warn(
        JSON.stringify({ event: 'dispatcher.loadCreds_failed', message: (err as Error)?.message }),
      );
    }
    return creds;
  }

  /** Write a failed batch to the D1 dead-letter table. Never throws. */
  private async deadLetter(
    batch: readonly IncomingEvent[],
    failedProvider: string,
    now: number,
  ): Promise<void> {
    const db = this.env.DB;
    if (!db) return;
    try {
      for (const e of batch) {
        await db
          .prepare(
            'INSERT INTO dead_letter_events (id, eventId, siteId, failedProvider, error, retryCount, nextRetryAt, payload, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
          )
          .bind(
            crypto.randomUUID(),
            e.eventId,
            e.siteId,
            failedProvider,
            'forward_failed',
            now + 30_000,
            JSON.stringify(e),
            now,
          )
          .run();
      }
    } catch (err) {
      console.warn(
        JSON.stringify({ event: 'dispatcher.deadLetter_failed', message: (err as Error)?.message }),
      );
    }
  }
}

/** Deterministic 0-1 unit from an event id (seeded sampling, no RNG). */
function hashUnit(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
