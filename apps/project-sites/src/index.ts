/**
 * Project Sites Cloudflare Worker
 * Main entry point for the API and site delivery
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';

import type { AppEnv, QueueMessage, CronContext } from './types.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { authMiddleware } from './middleware/auth.js';
import { dbMiddleware } from './middleware/db.js';

// Routes
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { orgRoutes } from './routes/orgs.js';
import { siteRoutes } from './routes/sites.js';
import { hostnameRoutes } from './routes/hostnames.js';
import { billingRoutes } from './routes/billing.js';
import { webhookRoutes } from './routes/webhooks.js';
import { adminRoutes } from './routes/admin.js';
import { intakeRoutes } from './routes/intake.js';
import { siteServeHandler } from './routes/serve.js';

// Queue handlers
import { handleQueueMessage } from './handlers/queue.js';
import { handleScheduled } from './handlers/scheduled.js';

// ============================================================================
// APP INITIALIZATION
// ============================================================================

const app = new Hono<AppEnv>();

// ============================================================================
// GLOBAL MIDDLEWARE
// ============================================================================

// Request ID (must be first)
app.use('*', requestIdMiddleware);

// Timing headers (development only)
app.use('*', timing());

// Secure headers
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.stripe.com', 'https://r.stripe.com'],
      frameSrc: ["'self'", 'https://js.stripe.com', 'https://challenges.cloudflare.com'],
    },
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
  })
);

// CORS
app.use(
  '/api/*',
  cors({
    origin: [
      'https://bolt.megabyte.space',
      'https://sites.megabyte.space',
      'http://localhost:5173',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  })
);

// Logger (development)
if (process.env.NODE_ENV !== 'production') {
  app.use('*', logger());
}

// Database client
app.use('*', dbMiddleware);

// Auth (for API routes)
app.use('/api/*', authMiddleware);

// Error handler (must wrap all routes)
app.onError(errorHandler);

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.route('/health', healthRoutes);

// Public intake (no auth required)
app.route('/api/intake', intakeRoutes);

// Auth routes
app.route('/api/auth', authRoutes);

// Protected API routes
app.route('/api/orgs', orgRoutes);
app.route('/api/sites', siteRoutes);
app.route('/api/hostnames', hostnameRoutes);
app.route('/api/billing', billingRoutes);

// Admin routes
app.route('/api/admin', adminRoutes);

// Webhook routes (no auth, signature verification)
app.route('/webhooks', webhookRoutes);

// Site serving (catch-all for subdomain routing)
app.get('*', siteServeHandler);

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  fetch: app.fetch,

  // Queue handler
  async queue(batch: MessageBatch<QueueMessage>, env: AppEnv['Bindings']): Promise<void> {
    for (const message of batch.messages) {
      try {
        await handleQueueMessage(message.body, env);
        message.ack();
      } catch (error) {
        console.error('Queue message failed:', error);
        message.retry();
      }
    }
  },

  // Scheduled handler (cron)
  async scheduled(
    event: ScheduledEvent,
    env: AppEnv['Bindings'],
    ctx: ExecutionContext
  ): Promise<void> {
    const cronContext: CronContext = {
      env,
      ctx,
      cron: event.cron,
    };
    await handleScheduled(cronContext);
  },
};
