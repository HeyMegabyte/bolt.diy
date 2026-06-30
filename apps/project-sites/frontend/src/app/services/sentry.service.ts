/**
 * @module services/sentry.service
 * @description Thin browser Sentry client. Sends exceptions to Sentry's
 * envelope API via raw fetch — zero npm deps, tree-shakeable.
 *
 * The canonical @sentry/angular SDK was removed (see docs/observability/sentry-removed.md)
 * because it adds ~60 KB to the bundle. This thin client replicates the
 * critical path (captureException + breadcrumbs) at ~2 KB.
 *
 * Child sites (generated websites) are NEVER instrumented — only the
 * projectsites.dev admin SPA + marketing surface use this service.
 */

import { Injectable } from '@angular/core';

interface SentryEvent {
  event_id: string;
  timestamp: number;
  level: 'error' | 'warning' | 'info';
  logger: string;
  platform: string;
  exception?: { values: Array<{ type: string; value: string; stacktrace?: { frames: Array<Record<string, unknown>> } }> };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  request?: { url: string; headers?: Record<string, string> };
}

@Injectable({ providedIn: 'root' })
export class SentryService {
  private dsn = '';
  private envelopeUrl = '';
  private enabled = false;

  constructor() {
    this.init();
  }

  /** Parse the DSN from a meta tag or window config. Lazy — no blocking init. */
  private init(): void {
    // Try window.__SENTRY_DSN__ injected by index.html, then meta tag
    const win = window as unknown as { __SENTRY_DSN__?: string };
    const dsn =
      win.__SENTRY_DSN__ ??
      document.querySelector<HTMLMetaElement>('meta[name="sentry-dsn"]')?.content ??
      '';

    if (!dsn) return;

    try {
      const url = new URL(dsn);
      const projectId = url.pathname.replace(/^\//, '');
      this.envelopeUrl = `${url.protocol}//${url.host}/api/${projectId}/envelope/`;
      this.dsn = dsn;
      this.enabled = true;
    } catch {
      // Invalid DSN — Sentry stays dark
    }
  }

  /**
   * Sends an exception to Sentry. Fire-and-forget — never throws.
   *
   * @param error - The Error object.
   * @param tags - Optional tags (route, component, userId).
   * @param extra - Optional extra context.
   */
  captureException(
    error: Error,
    tags?: Record<string, string>,
    extra?: Record<string, unknown>,
  ): void {
    if (!this.enabled) return;

    const eventId = this.generateEventId();
    const event: SentryEvent = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      level: 'error',
      logger: 'angular',
      platform: 'javascript',
      exception: {
        values: [
          {
            type: error.name || 'Error',
            value: (error.message || 'Unknown error').slice(0, 8192),
            stacktrace: error.stack
              ? {
                  frames: error.stack.split('\n').map((line) => ({
                    context_line: line.trim(),
                  })),
                }
              : undefined,
          },
        ],
      },
      tags: {
        environment: 'production',
        url: location.href,
        ...tags,
      },
      extra,
      request: { url: location.href },
    };

    this.send(event);
  }

  /**
   * Adds a breadcrumb to the next exception event. In the thin client
   * this logs structured JSON; the full SDK attaches to scope.
   */
  addBreadcrumb(message: string, category = 'default', data?: Record<string, unknown>): void {
    if (!this.enabled) return;
    console.warn(
      `[sentry:breadcrumb] ${message}`,
      JSON.stringify({ category, data: data ?? {}, url: location.href }),
    );
  }

  private async send(event: SentryEvent): Promise<void> {
    const envelope = this.buildEnvelope(event);
    try {
      await fetch(this.envelopeUrl, {
        method: 'POST',
        body: envelope,
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        keepalive: true,
      });
    } catch {
      // Sentry is best-effort — never a hard dependency
    }
  }

  private buildEnvelope(event: SentryEvent): string {
    const header = JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() });
    const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json' });
    const payload = JSON.stringify(event);
    return `${header}\n${itemHeader}\n${payload}\n`;
  }

  private generateEventId(): string {
    return crypto.randomUUID().replace(/-/g, '');
  }
}
