/**
 * Control-plane Worker entry.
 *
 * Middleware order (per ARCHITECTURE.md):
 *   request-id → security-headers → payload-limit → CORS → auth → view-as → tenant
 *   → rate-limit (per route) → router → error-handler
 *
 * Exports the DO classes (one binding each in wrangler.jsonc) + a default `{ fetch,
 * scheduled, queue }` object.
 *
 * Env parsed via `parseEnv()` at the boundary — boot refuses with a deeplinked
 * creation URL when a required var is missing.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HonoEnv } from './types.js';
import { parseEnv } from './env.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { securityHeadersMiddleware } from './middleware/security-headers.js';
import { payloadLimit } from './middleware/payload-limit.js';
import { authMiddleware } from './middleware/auth.js';
import { viewAsMiddleware } from './middleware/view-as.js';
import { tenantMiddleware } from './middleware/tenant.js';
import { errorHandler } from './middleware/error-handler.js';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import sitesRoutes from './routes/sites.js';
import quotesRoutes from './routes/quotes.js';
import jobsRoutes from './routes/jobs.js';
import crewRoutes from './routes/crew.js';
import bookingsRoutes from './routes/bookings.js';
import billingRoutes from './routes/billing.js';
import teamRoutes from './routes/team.js';
import settingsRoutes from './routes/settings.js';
import integrationsRoutes from './routes/integrations.js';
import aiRoutes from './routes/ai.js';
import notificationsRoutes from './routes/notifications.js';
import webhookRoutes from './routes/webhooks.js';

// Durable Object class exports (wrangler.jsonc binding names map to these).
export { SiteLogStream as LogHub } from './durable-objects/site-log-stream.js';
export { JobChatRoom as JobChatHub } from './durable-objects/job-chat-room.js';
export { JobTrackingHub } from './durable-objects/job-tracking-hub.js';
export { UserNotificationQueue as NotificationHub } from './durable-objects/user-notification-queue.js';
export { VoiceOrchestrator } from './durable-objects/voice-orchestrator.js';

const app = new Hono<HonoEnv>();

// Global middleware (order matters).
app.use('*', requestIdMiddleware);
app.use('*', securityHeadersMiddleware);
app.use('*', errorHandler);
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed = [
        c.env.APP_BASE_URL,
        'https://app.projectsites.dev',
        'https://projectsites.dev',
      ];
      return origin && allowed.includes(origin) ? origin : allowed[0]!;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'content-type',
      'authorization',
      'x-request-id',
      'x-tenant-id',
      'x-view-as',
      'cf-turnstile-response',
      'stripe-signature',
    ],
    exposeHeaders: ['x-request-id'],
    maxAge: 600,
  }),
);

// Webhooks BEFORE auth — they verify their own signatures and need the raw body.
app.use('/webhooks/*', payloadLimit(8 * 1024 * 1024));
app.route('/webhooks', webhookRoutes);

// Health is public.
app.route('/health', healthRoutes);

// Everything else: parse env, then auth, then tenant scoping.
app.use('/api/*', payloadLimit());
app.use('/auth/*', payloadLimit());
app.use('*', async (c, next) => {
  parseEnv(c.env);
  return next();
});
app.use('/api/*', authMiddleware);
app.use('/api/*', viewAsMiddleware);
app.use('/api/*', tenantMiddleware);
app.use('/auth/*', authMiddleware);

// Mounts.
app.route('/auth', authRoutes);
app.route('/api/me', meRoutes);
app.route('/api/sites', sitesRoutes);
app.route('/api/quotes', quotesRoutes);
app.route('/api/jobs', jobsRoutes);
app.route('/api/crew', crewRoutes);
app.route('/api/bookings', bookingsRoutes);
app.route('/api/billing', billingRoutes);
app.route('/api/team', teamRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/integrations', integrationsRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/notifications', notificationsRoutes);

app.notFound((c) =>
  c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `route ${c.req.method} ${new URL(c.req.url).pathname} not found`,
        request_id: c.get('requestId') ?? 'unknown',
      },
    },
    404,
  ),
);

export type AppType = typeof app;

interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

interface QueueMessage<T = unknown> {
  id: string;
  timestamp: number;
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface QueueBatch<T = unknown> {
  queue: string;
  messages: QueueMessage<T>[];
}

export default {
  fetch: app.fetch,

  /** Cron triggers — see wrangler.jsonc `triggers.crons`. */
  async scheduled(controller: ScheduledController, env: HonoEnv['Bindings']): Promise<void> {
    if (controller.cron === '0 * * * *') {
      // Hourly: cleanup expired magic links + oauth_state.
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM magic_links WHERE expires_at < ?1`).bind(now),
        env.DB.prepare(`DELETE FROM oauth_state WHERE expires_at < ?1`).bind(now),
        env.DB.prepare(`DELETE FROM webauthn_challenges WHERE expires_at < ?1`).bind(now),
        env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?1`).bind(now),
      ]);
    }
  },

  /** Queue consumer. Wired when wrangler.jsonc declares `[[queues.consumers]]`. */
  async queue(batch: QueueBatch, _env: HonoEnv['Bindings']): Promise<void> {
    for (const msg of batch.messages) {
      try {
        // Default: just ack. Per-queue dispatch lands here as the v2 grows.
        msg.ack();
      } catch {
        msg.retry({ delaySeconds: 30 });
      }
    }
  },
};
