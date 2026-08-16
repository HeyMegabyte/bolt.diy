jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQueryOne, dbInsert, dbUpdate, dbExecute } from '../services/db.js';
import {
  checkWebhookIdempotency,
  storeWebhookEvent,
  markWebhookProcessed,
  resetWebhookForRetry,
} from '../services/webhook.js';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;
const mockExecute = dbExecute as jest.MockedFunction<typeof dbExecute>;

const mockDb = {} as D1Database;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── checkWebhookIdempotency ─────────────────────────────────

describe('checkWebhookIdempotency', () => {
  it('returns isDuplicate:false when no existing event', async () => {
    mockQueryOne.mockResolvedValue(null);

    const result = await checkWebhookIdempotency(mockDb, 'stripe', 'evt_123');

    expect(result.isDuplicate).toBe(false);
    expect(result.existingId).toBeUndefined();
  });

  it('returns isDuplicate:true for a PROCESSED (terminally handled) event', async () => {
    mockQueryOne.mockResolvedValue({ id: 'existing-uuid', status: 'processed', attempts: 1 });

    const result = await checkWebhookIdempotency(mockDb, 'stripe', 'evt_123');

    expect(result.isDuplicate).toBe(true);
    expect(result.existingId).toBe('existing-uuid');
  });

  it('returns isDuplicate:true for a QUARANTINED event (poison pill — never reprocess)', async () => {
    mockQueryOne.mockResolvedValue({ id: 'q-uuid', status: 'quarantined', attempts: 5 });

    const result = await checkWebhookIdempotency(mockDb, 'stripe', 'evt_q');

    expect(result.isDuplicate).toBe(true);
  });

  it('treats a FAILED event as retry-eligible (NOT a duplicate) so a transient failure recovers', async () => {
    mockQueryOne.mockResolvedValue({ id: 'f-uuid', status: 'failed', attempts: 2 });

    const result = await checkWebhookIdempotency(mockDb, 'stripe', 'evt_f');

    // A stored-but-failed event MUST reprocess on redelivery — the whole point of the fix.
    expect(result.isDuplicate).toBe(false);
    expect(result.existingId).toBe('f-uuid');
    expect(result.existingStatus).toBe('failed');
    expect(result.existingAttempts).toBe(2);
  });

  it('treats a PROCESSING (crashed mid-flight) event as retry-eligible', async () => {
    mockQueryOne.mockResolvedValue({ id: 'p-uuid', status: 'processing', attempts: 1 });

    const result = await checkWebhookIdempotency(mockDb, 'stripe', 'evt_p');

    expect(result.isDuplicate).toBe(false);
    expect(result.existingId).toBe('p-uuid');
    expect(result.existingAttempts).toBe(1);
  });

  it('queries webhook_events with provider and event_id', async () => {
    mockQueryOne.mockResolvedValue(null);

    await checkWebhookIdempotency(mockDb, 'dub', 'evt_abc');

    expect(mockQueryOne).toHaveBeenCalledWith(
      mockDb,
      expect.stringContaining('provider = ?'),
      expect.arrayContaining(['dub', 'evt_abc']),
    );
  });
});

// ─── storeWebhookEvent ───────────────────────────────────────

describe('storeWebhookEvent', () => {
  it('returns id on successful insert', async () => {
    mockInsert.mockResolvedValue({ error: null });

    const result = await storeWebhookEvent(mockDb, {
      provider: 'stripe',
      event_id: 'evt_456',
      event_type: 'checkout.session.completed',
    });

    expect(result.id).toBeTruthy();
    expect(result.error).toBeNull();
  });

  it('returns error when DB fails', async () => {
    mockInsert.mockResolvedValue({ error: 'Insert failed' });

    const result = await storeWebhookEvent(mockDb, {
      provider: 'stripe',
      event_id: 'evt_789',
      event_type: 'payment_intent.succeeded',
    });

    expect(result.id).toBeNull();
    expect(result.error).toBe('Insert failed');
  });

  it('sets default status to received', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await storeWebhookEvent(mockDb, {
      provider: 'stripe',
      event_id: 'evt_100',
      event_type: 'invoice.paid',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        status: 'received',
      }),
    );
  });

  it('sets attempts to 1 (this is the first processing attempt)', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await storeWebhookEvent(mockDb, {
      provider: 'lago',
      event_id: 'evt_200',
      event_type: 'subscription.created',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        attempts: 1,
      }),
    );
  });
});

// ─── markWebhookProcessed ────────────────────────────────────

describe('markWebhookProcessed', () => {
  it('sets status to processed and processed_at', async () => {
    mockUpdate.mockResolvedValue({ error: null, changes: 1 });

    await markWebhookProcessed(mockDb, 'event-uuid-1', 'processed');

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        status: 'processed',
        processed_at: expect.any(String),
      }),
      'id = ?',
      ['event-uuid-1'],
    );
  });

  it('sets status to failed with error_message', async () => {
    mockUpdate.mockResolvedValue({ error: null, changes: 1 });

    await markWebhookProcessed(mockDb, 'event-uuid-2', 'failed', 'Something broke');

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        status: 'failed',
        error_message: 'Something broke',
      }),
      'id = ?',
      ['event-uuid-2'],
    );
  });

  it('defaults status to processed when not specified', async () => {
    mockUpdate.mockResolvedValue({ error: null, changes: 1 });

    await markWebhookProcessed(mockDb, 'event-uuid-3');

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        status: 'processed',
      }),
      'id = ?',
      ['event-uuid-3'],
    );
  });

  it('WARNS but never throws when the outcome write itself fails', async () => {
    // Called on both the success path AND inside the route's catch — a throw here
    // would mask the original error, so a failed write must surface to logs only.
    mockUpdate.mockResolvedValue({ error: 'D1_ERROR: disk full', changes: 0 });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      markWebhookProcessed(mockDb, 'event-uuid-4', 'failed', 'orig error'),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(logged).toMatchObject({
      service: 'webhook',
      message: 'mark_webhook_processed_write_failed',
      event_id: 'event-uuid-4',
      target_status: 'failed',
    });
    warnSpy.mockRestore();
  });

  it('sets status to quarantined (poison-pill terminal after max attempts)', async () => {
    mockUpdate.mockResolvedValue({ error: null, changes: 1 });

    await markWebhookProcessed(mockDb, 'event-uuid-5', 'quarantined', 'gave up after 5 tries');

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        status: 'quarantined',
        error_message: 'gave up after 5 tries',
      }),
      'id = ?',
      ['event-uuid-5'],
    );
  });
});

// ─── resetWebhookForRetry ────────────────────────────────────

describe('resetWebhookForRetry', () => {
  it('resets a stored row to processing and increments attempts (row reuse on redelivery)', async () => {
    mockExecute.mockResolvedValue({ error: null, changes: 1 });

    const result = await resetWebhookForRetry(mockDb, 'evt-row-1');

    expect(result.error).toBeNull();
    const [, sql, params] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/UPDATE webhook_events SET/i);
    expect(sql).toMatch(/status = 'processing'/i);
    expect(sql).toMatch(/attempts = attempts \+ 1/i);
    expect(params).toEqual(expect.arrayContaining(['evt-row-1']));
  });

  it('surfaces a D1 error string instead of throwing', async () => {
    mockExecute.mockResolvedValue({ error: 'D1_ERROR: locked', changes: 0 });

    const result = await resetWebhookForRetry(mockDb, 'evt-row-2');

    expect(result.error).toBe('D1_ERROR: locked');
  });
});
