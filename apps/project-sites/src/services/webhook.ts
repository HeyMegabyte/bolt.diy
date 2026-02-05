/**
 * Webhook Service Implementation
 * Generic, reusable webhook handling with signature verification and idempotency
 */
import { generateId, nowISO, sanitizeText } from '@project-sites/shared';

// =============================================================================
// TYPES
// =============================================================================

export interface WebhookServiceDeps {
  db: Database;
  kv: KVNamespace;
  r2?: R2Bucket;
}

interface Database {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ rowsAffected: number }>;
}

export interface StoredWebhookEvent {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  payload: any;
  payloadPointer?: string;
  headers: Record<string, string>;
  status: 'pending' | 'processing' | 'processed' | 'failed';
  processedAt?: string;
  result?: any;
  error?: string;
  retryCount: number;
  receivedAt: string;
  createdAt: string;
}

// =============================================================================
// WEBHOOK SERVICE CLASS
// =============================================================================

export class WebhookService {
  private db: Database;
  private kv: KVNamespace;
  private r2?: R2Bucket;

  // Maximum payload size to store inline (64KB)
  private readonly MAX_INLINE_PAYLOAD = 64 * 1024;
  // Maximum retries
  private readonly MAX_RETRIES = 5;
  // Idempotency TTL (7 days)
  private readonly IDEMPOTENCY_TTL = 7 * 24 * 60 * 60;

  constructor(deps: WebhookServiceDeps) {
    this.db = deps.db;
    this.kv = deps.kv;
    this.r2 = deps.r2;
  }

  // ===========================================================================
  // SIGNATURE VERIFICATION
  // ===========================================================================

  async verifySignature(params: {
    provider: string;
    payload: string;
    headers: Record<string, string>;
    secret: string;
  }): Promise<{
    valid: boolean;
    error?: string;
    timestamp?: number;
    eventId?: string;
  }> {
    switch (params.provider) {
      case 'stripe':
        return this.verifyStripeSignature(
          params.payload,
          params.headers['stripe-signature'] ?? '',
          params.secret,
        );

      case 'github':
        const ghValid = await this.verifyGitHubSignature(
          params.payload,
          params.headers['x-hub-signature-256'] ?? '',
          params.secret,
        );
        return { valid: ghValid };

      case 'slack':
        const slackValid = await this.verifySlackSignature(
          params.payload,
          params.headers['x-slack-request-timestamp'] ?? '',
          params.headers['x-slack-signature'] ?? '',
          params.secret,
        );
        return { valid: slackValid };

      default:
        throw new Error(`Unsupported provider: ${params.provider}`);
    }
  }

  async verifyStripeSignature(
    payload: string,
    signature: string,
    secret: string,
  ): Promise<{
    valid: boolean;
    timestamp?: number;
    eventId?: string;
    error?: string;
  }> {
    if (!signature) {
      return { valid: false, error: 'Missing signature header' };
    }

    // Parse signature header
    const parts: Record<string, string> = {};
    for (const part of signature.split(',')) {
      const [key, value] = part.split('=');
      if (key && value) {
        parts[key] = value;
      }
    }

    const timestamp = parseInt(parts.t ?? '0', 10);
    const v1Signature = parts.v1;

    if (!timestamp || !v1Signature) {
      return { valid: false, error: 'Invalid signature format' };
    }

    // Check timestamp tolerance (5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
      return { valid: false, error: 'Timestamp outside tolerance' };
    }

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(signedPayload),
    );

    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Constant-time comparison
    const valid = this.constantTimeEqual(expectedSignature, v1Signature);

    if (!valid) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Extract event ID
    let eventId: string | undefined;
    try {
      const event = JSON.parse(payload) as { id?: string };
      eventId = event.id;
    } catch {
      // Ignore parse errors
    }

    return { valid: true, timestamp, eventId };
  }

  async verifyGitHubSignature(
    payload: string,
    signature: string,
    secret: string,
  ): Promise<boolean> {
    // Only accept SHA-256
    if (!signature.startsWith('sha256=')) {
      return false;
    }

    const expectedSignature = signature.slice(7);
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload),
    );

    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return this.constantTimeEqual(computedSignature, expectedSignature);
  }

  async verifySlackSignature(
    payload: string,
    timestamp: string,
    signature: string,
    secret: string,
  ): Promise<boolean> {
    // Check timestamp (5 minutes)
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      return false;
    }

    if (!signature.startsWith('v0=')) {
      return false;
    }

    const expectedSignature = signature.slice(3);
    const baseString = `v0:${timestamp}:${payload}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(baseString),
    );

    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return this.constantTimeEqual(computedSignature, expectedSignature);
  }

  // ===========================================================================
  // IDEMPOTENCY
  // ===========================================================================

  async checkIdempotency(provider: string, eventId: string): Promise<{
    isProcessed: boolean;
    processedAt?: string;
    result?: any;
  }> {
    const key = `idempo:${provider}:${eventId}`;
    const value = await this.kv.get(key);

    if (!value) {
      return { isProcessed: false };
    }

    try {
      const data = JSON.parse(value);
      return {
        isProcessed: true,
        processedAt: data.processedAt,
        result: data.result,
      };
    } catch {
      return { isProcessed: true };
    }
  }

  async markProcessed(provider: string, eventId: string, result?: any): Promise<void> {
    const key = `idempo:${provider}:${eventId}`;
    await this.kv.put(
      key,
      JSON.stringify({ processedAt: nowISO(), result }),
      { expirationTtl: this.IDEMPOTENCY_TTL },
    );
  }

  // ===========================================================================
  // EVENT STORAGE
  // ===========================================================================

  async storeWebhookEvent(params: {
    provider: string;
    eventId: string;
    eventType: string;
    payload: any;
    headers: Record<string, string>;
    receivedAt: string;
  }): Promise<string> {
    const id = generateId();
    const sanitizedEventType = sanitizeText(params.eventType);

    // Redact sensitive data from payload
    const redactedPayload = this.redactSensitiveData(params.payload);

    // Check if payload is too large
    const payloadStr = JSON.stringify(redactedPayload);
    let payloadPointer: string | undefined;
    let storedPayload: any = redactedPayload;

    if (payloadStr.length > this.MAX_INLINE_PAYLOAD && this.r2) {
      // Store in R2
      payloadPointer = `webhooks/${params.provider}/${id}.json`;
      await this.r2.put(payloadPointer, payloadStr);
      storedPayload = null;
    }

    await this.db.execute(
      `INSERT INTO webhook_events (id, provider, event_id, event_type, payload, payload_pointer,
       headers, status, retry_count, received_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        params.provider,
        params.eventId,
        sanitizedEventType,
        storedPayload ? JSON.stringify(storedPayload) : null,
        payloadPointer ?? null,
        JSON.stringify(params.headers),
        'pending',
        0,
        params.receivedAt,
        nowISO(),
      ],
    );

    return id;
  }

  async getWebhookEvent(eventId: string): Promise<StoredWebhookEvent | null> {
    const events = await this.db.query<any>(
      `SELECT id, provider, event_id as "eventId", event_type as "eventType",
       payload, payload_pointer as "payloadPointer", headers, status,
       processed_at as "processedAt", result, error, retry_count as "retryCount",
       received_at as "receivedAt", created_at as "createdAt"
       FROM webhook_events WHERE id = $1`,
      [eventId],
    );

    const event = events[0];
    if (!event) {
      return null;
    }

    // Load payload from R2 if needed
    if (event.payloadPointer && !event.payload && this.r2) {
      const obj = await this.r2.get(event.payloadPointer);
      if (obj) {
        event.payload = JSON.parse(await obj.text());
      }
    } else if (typeof event.payload === 'string') {
      event.payload = JSON.parse(event.payload);
    }

    if (typeof event.headers === 'string') {
      event.headers = JSON.parse(event.headers);
    }

    if (typeof event.result === 'string') {
      event.result = JSON.parse(event.result);
    }

    return event;
  }

  async markEventProcessed(eventId: string, result: {
    success: boolean;
    result?: any;
    error?: string;
  }): Promise<void> {
    const status = result.success ? 'processed' : 'failed';

    await this.db.execute(
      `UPDATE webhook_events SET status = $1, processed_at = $2, result = $3, error = $4
       WHERE id = $5`,
      [
        status,
        nowISO(),
        result.result ? JSON.stringify(result.result) : null,
        result.error ?? null,
        eventId,
      ],
    );
  }

  // ===========================================================================
  // REPLAY
  // ===========================================================================

  async replayWebhookEvent(eventId: string): Promise<{
    success: boolean;
    eventId: string;
    message?: string;
  }> {
    const event = await this.getWebhookEvent(eventId);

    if (!event) {
      return { success: false, eventId, message: 'Event not found' };
    }

    if (event.status === 'processed') {
      return { success: false, eventId, message: 'Event already processed' };
    }

    if (event.retryCount >= this.MAX_RETRIES) {
      return { success: false, eventId, message: 'Max retries exhausted' };
    }

    // Increment retry count
    await this.db.execute(
      `UPDATE webhook_events SET retry_count = retry_count + 1, status = 'processing' WHERE id = $1`,
      [eventId],
    );

    // Return success - actual processing happens elsewhere
    return { success: true, eventId };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  private redactSensitiveData(payload: any): any {
    if (typeof payload !== 'object' || payload === null) {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => this.redactSensitiveData(item));
    }

    const sensitiveKeys = ['card', 'number', 'cvc', 'exp', 'password', 'secret', 'token'];
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase();

      if (sensitiveKeys.some((k) => lowerKey.includes(k))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        result[key] = this.redactSensitiveData(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
