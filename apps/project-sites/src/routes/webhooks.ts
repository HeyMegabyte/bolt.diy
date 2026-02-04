/**
 * Webhook routes
 * Generic framework with signature verification and idempotency
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { WebhookService } from '../services/webhook.js';
import { BillingService } from '../services/billing.js';
import {
  stripeEventSchema,
  ValidationError,
  AuthError,
} from '@project-sites/shared';

export const webhookRoutes = new Hono<AppEnv>();

// Stripe webhook
webhookRoutes.post('/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    throw new AuthError('Missing Stripe signature');
  }

  const rawBody = await c.req.text();
  const webhookService = new WebhookService(c);

  // Verify signature
  const event = await webhookService.verifyStripeSignature(rawBody, signature);

  // Check idempotency
  const isProcessed = await webhookService.checkIdempotency('stripe', event.id);
  if (isProcessed) {
    return c.json({ success: true, message: 'Already processed' });
  }

  // Store webhook event
  await webhookService.storeWebhookEvent({
    provider: 'stripe',
    event_id: event.id,
    event_type: event.type,
    payload: event,
  });

  // Process event
  const billingService = new BillingService(c);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await billingService.handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await billingService.handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await billingService.handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.paid':
        await billingService.handleInvoicePaid(event.data.object);
        break;

      case 'invoice.payment_failed':
        await billingService.handlePaymentFailed(event.data.object);
        break;

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    // Mark as processed
    await webhookService.markProcessed('stripe', event.id);

  } catch (error) {
    await webhookService.markFailed('stripe', event.id, error);
    throw error;
  }

  return c.json({ success: true, received: true });
});

// Chatwoot webhook
webhookRoutes.post('/chatwoot', async (c) => {
  const webhookService = new WebhookService(c);

  // Verify signature (if configured)
  const signature = c.req.header('x-chatwoot-signature');
  const rawBody = await c.req.text();

  // TODO: Implement Chatwoot signature verification

  const body = JSON.parse(rawBody);
  const eventId = body.id || `chatwoot-${Date.now()}`;

  // Check idempotency
  const isProcessed = await webhookService.checkIdempotency('chatwoot', eventId);
  if (isProcessed) {
    return c.json({ success: true, message: 'Already processed' });
  }

  // Store webhook event
  await webhookService.storeWebhookEvent({
    provider: 'chatwoot',
    event_id: eventId,
    event_type: body.event,
    payload: body,
  });

  // Process event
  try {
    switch (body.event) {
      case 'message_created':
        // Handle new message
        console.log('Chatwoot message created:', body.content);
        break;

      case 'conversation_status_changed':
        // Handle status change
        console.log('Chatwoot conversation status changed:', body);
        break;

      default:
        console.log(`Unhandled Chatwoot event: ${body.event}`);
    }

    await webhookService.markProcessed('chatwoot', eventId);

  } catch (error) {
    await webhookService.markFailed('chatwoot', eventId, error);
    throw error;
  }

  return c.json({ success: true, received: true });
});

// Dub webhook (claim links)
webhookRoutes.post('/dub', async (c) => {
  const webhookService = new WebhookService(c);
  const rawBody = await c.req.text();
  const body = JSON.parse(rawBody);
  const eventId = body.id || `dub-${Date.now()}`;

  // Check idempotency
  const isProcessed = await webhookService.checkIdempotency('dub', eventId);
  if (isProcessed) {
    return c.json({ success: true, message: 'Already processed' });
  }

  // Store webhook event
  await webhookService.storeWebhookEvent({
    provider: 'dub',
    event_id: eventId,
    event_type: body.event,
    payload: body,
  });

  try {
    switch (body.event) {
      case 'link.clicked':
        // Track claim link clicks
        console.log('Dub link clicked:', body.link);
        break;

      default:
        console.log(`Unhandled Dub event: ${body.event}`);
    }

    await webhookService.markProcessed('dub', eventId);

  } catch (error) {
    await webhookService.markFailed('dub', eventId, error);
    throw error;
  }

  return c.json({ success: true, received: true });
});

// Novu webhook
webhookRoutes.post('/novu', async (c) => {
  const webhookService = new WebhookService(c);
  const rawBody = await c.req.text();
  const body = JSON.parse(rawBody);
  const eventId = body.id || `novu-${Date.now()}`;

  // Check idempotency
  const isProcessed = await webhookService.checkIdempotency('novu', eventId);
  if (isProcessed) {
    return c.json({ success: true, message: 'Already processed' });
  }

  // Store webhook event
  await webhookService.storeWebhookEvent({
    provider: 'novu',
    event_id: eventId,
    event_type: body.type,
    payload: body,
  });

  try {
    // Process Novu events
    console.log(`Novu event: ${body.type}`);
    await webhookService.markProcessed('novu', eventId);

  } catch (error) {
    await webhookService.markFailed('novu', eventId, error);
    throw error;
  }

  return c.json({ success: true, received: true });
});

// Lago webhook (optional, feature-flagged)
webhookRoutes.post('/lago', async (c) => {
  const webhookService = new WebhookService(c);
  const rawBody = await c.req.text();
  const body = JSON.parse(rawBody);
  const eventId = body.webhook_id || `lago-${Date.now()}`;

  // Check if Lago is enabled
  if (!c.env.LAGO_API_KEY) {
    return c.json({ success: true, message: 'Lago not enabled' });
  }

  // Check idempotency
  const isProcessed = await webhookService.checkIdempotency('lago', eventId);
  if (isProcessed) {
    return c.json({ success: true, message: 'Already processed' });
  }

  // Store webhook event
  await webhookService.storeWebhookEvent({
    provider: 'lago',
    event_id: eventId,
    event_type: body.webhook_type,
    payload: body,
  });

  try {
    // Process Lago events
    console.log(`Lago event: ${body.webhook_type}`);
    await webhookService.markProcessed('lago', eventId);

  } catch (error) {
    await webhookService.markFailed('lago', eventId, error);
    throw error;
  }

  return c.json({ success: true, received: true });
});
