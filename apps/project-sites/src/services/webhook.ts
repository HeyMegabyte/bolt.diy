/**
 * Webhook service
 * Generic framework with signature verification and idempotency
 */
import type { AppContext } from '../types.js';
import {
  generateUuid,
  hmacSha256,
  verifyHmacSha256,
  timingSafeEqual,
  AuthError,
  ValidationError,
  WEBHOOK_PROVIDERS,
} from '@project-sites/shared';

interface WebhookEvent {
  provider: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export class WebhookService {
  constructor(private c: AppContext) {}

  private get db() {
    return this.c.get('db');
  }

  private get stripe() {
    return this.c.get('stripe');
  }

  private get env() {
    return this.c.env;
  }

  // ============================================================================
  // SIGNATURE VERIFICATION
  // ============================================================================

  async verifyStripeSignature(rawBody: string, signature: string): Promise<any> {
    try {
      const event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.env.STRIPE_WEBHOOK_SECRET
      );
      return event;
    } catch (error) {
      throw new AuthError('Invalid Stripe signature');
    }
  }

  async verifyHmacSignature(
    rawBody: string,
    signature: string,
    secret: string,
    timestampHeader?: string
  ): Promise<boolean> {
    // Check timestamp tolerance (5 minutes)
    if (timestampHeader) {
      const timestamp = parseInt(timestampHeader, 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > 300) {
        throw new AuthError('Webhook timestamp expired');
      }
    }

    // Verify HMAC signature
    const expectedSignature = await hmacSha256(secret, rawBody);
    return timingSafeEqual(expectedSignature, signature);
  }

  // ============================================================================
  // IDEMPOTENCY
  // ============================================================================

  async checkIdempotency(provider: string, eventId: string): Promise<boolean> {
    const key = `${provider}:${eventId}`;

    // Check KV cache first (fast path)
    const cached = await this.c.env.CACHE_KV.get(`idempo:${key}`);
    if (cached) {
      return true;
    }

    // Check database
    const { data: existing } = await this.db
      .from('webhook_events')
      .select('id, processed_at')
      .eq('provider', provider)
      .eq('event_id', eventId)
      .single();

    if (existing?.processed_at) {
      // Cache for future fast lookups
      await this.c.env.CACHE_KV.put(`idempo:${key}`, 'true', { expirationTtl: 86400 });
      return true;
    }

    return false;
  }

  // ============================================================================
  // EVENT STORAGE
  // ============================================================================

  async storeWebhookEvent(event: WebhookEvent): Promise<string> {
    const eventId = generateUuid();
    const idempotencyKey = `${event.provider}:${event.event_id}`;

    // Store payload in R2 if large
    let payloadR2Path: string | null = null;
    const payloadStr = JSON.stringify(event.payload);

    if (payloadStr.length > 64 * 1024) {
      // Store in R2
      payloadR2Path = `webhooks/${event.provider}/${eventId}.json`;
      await this.c.env.SITES_BUCKET.put(payloadR2Path, payloadStr, {
        httpMetadata: { contentType: 'application/json' },
      });
    }

    // Store in database
    await this.db.from('webhook_events').insert({
      id: eventId,
      provider: event.provider,
      event_id: event.event_id,
      event_type: event.event_type,
      payload_r2_path: payloadR2Path,
      payload_size_bytes: payloadStr.length,
      idempotency_key: idempotencyKey,
      request_id: this.c.get('request_id'),
      ip_address: this.c.req.header('CF-Connecting-IP'),
    });

    return eventId;
  }

  async markProcessed(provider: string, eventId: string): Promise<void> {
    const key = `${provider}:${eventId}`;

    // Update database
    await this.db
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider', provider)
      .eq('event_id', eventId);

    // Cache for idempotency
    await this.c.env.CACHE_KV.put(`idempo:${key}`, 'true', { expirationTtl: 86400 });
  }

  async markFailed(provider: string, eventId: string, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await this.db
      .from('webhook_events')
      .update({
        processing_error: errorMessage.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq('provider', provider)
      .eq('event_id', eventId);
  }

  // ============================================================================
  // REPLAY
  // ============================================================================

  async replayWebhookEvent(webhookEventId: string): Promise<void> {
    const { data: event, error } = await this.db
      .from('webhook_events')
      .select('*')
      .eq('id', webhookEventId)
      .single();

    if (error || !event) {
      throw new ValidationError('Webhook event not found');
    }

    // Get payload
    let payload: Record<string, unknown>;

    if (event.payload_r2_path) {
      const object = await this.c.env.SITES_BUCKET.get(event.payload_r2_path);
      if (!object) {
        throw new ValidationError('Webhook payload not found in R2');
      }
      payload = await object.json();
    } else {
      // For older events without separate payload storage
      payload = {};
    }

    // Clear processed status to allow reprocessing
    await this.db
      .from('webhook_events')
      .update({
        processed_at: null,
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', webhookEventId);

    // Clear idempotency cache
    const key = `${event.provider}:${event.event_id}`;
    await this.c.env.CACHE_KV.delete(`idempo:${key}`);

    // Queue for reprocessing
    await this.c.env.WORKFLOW_QUEUE.send({
      type: 'webhook_replay',
      payload: {
        webhook_event_id: webhookEventId,
        provider: event.provider,
        event_type: event.event_type,
        original_payload: payload,
      },
      metadata: {
        request_id: this.c.get('request_id'),
        trace_id: this.c.get('trace_id'),
        attempt: 1,
        max_attempts: 1,
        scheduled_at: new Date().toISOString(),
      },
    });
  }

  // ============================================================================
  // OUTBOUND WEBHOOKS
  // ============================================================================

  async sendSaleWebhook(payload: {
    site_id: string;
    org_id: string;
    stripe_customer_id: string;
    stripe_subscription_id: string;
    plan: string;
    amount_cents: number;
    currency: string;
  }): Promise<void> {
    const url = this.env.SALE_WEBHOOK_URL;
    const secret = this.env.SALE_WEBHOOK_SECRET;

    if (!url) {
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString(),
      request_id: this.c.get('request_id'),
      trace_id: this.c.get('trace_id'),
    });

    let signature = '';
    if (secret) {
      signature = await hmacSha256(secret, `${timestamp}.${body}`);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Timestamp': timestamp,
          'X-Webhook-Signature': signature,
        },
        body,
      });

      if (!response.ok) {
        console.error(`Sale webhook failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Sale webhook error:', error);
    }
  }
}
