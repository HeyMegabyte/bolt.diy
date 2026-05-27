/**
 * `@org/domain` — Zod-schema SSOT for the v2 build.
 *
 * Every cross-cutting entity in the admin + customer surfaces is
 * declared here. Feature libs import the schema + the inferred type;
 * never duplicate either side.
 */
export * from './lib/capabilities.js';
export * from './lib/role.js';
export * from './lib/tenant.js';
export * from './lib/user.js';
export * from './lib/session.js';
export * from './lib/site.js';
export * from './lib/booking.js';
export * from './lib/quote.js';
export * from './lib/job.js';
export * from './lib/crew.js';
export * from './lib/billing.js';
export * from './lib/payment-intent.js';
export * from './lib/log.js';
export * from './lib/snapshot.js';
export * from './lib/integration.js';
export * from './lib/audit.js';
export * from './lib/notification.js';
export * from './lib/ws-envelope.js';
