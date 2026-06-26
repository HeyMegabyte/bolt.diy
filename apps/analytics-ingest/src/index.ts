import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const AnalyticsEventEnvelopeSchema = z.object({
  event: z.string().min(1).max(128),
  tenant_id: z.string().min(1).max(64),
  site_id: z.string().optional(),
  org_id: z.string().optional(),
  user_id: z.string().optional(),
  visitor_id: z.string().optional(),
  session_id: z.string().optional(),
  request_id: z.string().optional(),
  trace_id: z.string().optional(),
  timestamp: z.string().datetime({ offset: true }),
  source: z.enum(['worker', 'frontend', 'webhook', 'cron', 'api']),
  properties: z.record(z.unknown()).optional(),
});

type AnalyticsEventEnvelope = z.infer<typeof AnalyticsEventEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

interface Env {
  CLICKHOUSE_URL: string;       // e.g. "https://clickhouse.example.com:8443"
  CLICKHOUSE_USER: string;
  CLICKHOUSE_PASSWORD: string;
  CLICKHOUSE_DATABASE: string;
}

// ---------------------------------------------------------------------------
// ClickHouse insert
// ---------------------------------------------------------------------------

/**
 * Batch-inserts validated events into ClickHouse via the HTTP interface.
 *
 * @param env - Worker bindings containing ClickHouse credentials
 * @param rows - Pre-validated event envelopes to insert
 * @returns Resolves on 2xx; throws a typed Error on failure
 *
 * @throws {ClickHouseInsertError} when ClickHouse returns a non-2xx status
 *
 * @example
 * await insertRows(env, [{ event: 'site.viewed', tenant_id: 'acme', ... }]);
 */
async function insertRows(env: Env, rows: AnalyticsEventEnvelope[]): Promise<void> {
  const query = `INSERT INTO ${env.CLICKHOUSE_DATABASE}.events FORMAT JSONEachRow`;
  const url = `${env.CLICKHOUSE_URL}/?query=${encodeURIComponent(query)}`;

  // Serialize as NDJSON (one JSON object per line).
  const body = rows
    .map((r) =>
      JSON.stringify({
        ...r,
        // Coerce optional fields to null so ClickHouse Nullable columns are satisfied.
        site_id: r.site_id ?? null,
        org_id: r.org_id ?? null,
        user_id: r.user_id ?? null,
        visitor_id: r.visitor_id ?? null,
        session_id: r.session_id ?? null,
        request_id: r.request_id ?? null,
        trace_id: r.trace_id ?? null,
        properties: JSON.stringify(r.properties ?? {}),
      }),
    )
    .join('\n');

  const creds = btoa(`${env.CLICKHOUSE_USER}:${env.CLICKHOUSE_PASSWORD}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      Authorization: `Basic ${creds}`,
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '(no body)');
    throw new ClickHouseInsertError(
      `ClickHouse insert failed: HTTP ${res.status} — ${detail.slice(0, 256)}`,
      res.status,
    );
  }
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

class ClickHouseInsertError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'ClickHouseInsertError';
  }
}

// ---------------------------------------------------------------------------
// Queue consumer
// ---------------------------------------------------------------------------

export default {
  /**
   * Processes a batch of analytics events from the CF Queue, validates each
   * message against the envelope schema, and bulk-inserts valid rows into
   * ClickHouse.  Invalid messages are acked and logged (they should never
   * successfully re-process).  ClickHouse failures propagate so CF Queue
   * retries the batch up to max_retries, then moves messages to the DLQ.
   *
   * @param batch - The CF Queue message batch
   * @param env   - Worker bindings
   */
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const valid: AnalyticsEventEnvelope[] = [];
    const invalid: string[] = [];

    for (const msg of batch.messages) {
      const result = AnalyticsEventEnvelopeSchema.safeParse(msg.body);
      if (result.success) {
        valid.push(result.data);
      } else {
        // Ack invalid messages so they don't block the queue.
        msg.ack();
        invalid.push(
          `[msgId=${msg.id}] ${result.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
    }

    if (invalid.length > 0) {
      console.warn(
        `analytics-ingest: ${invalid.length} invalid message(s) skipped:\n` +
          invalid.join('\n'),
      );
    }

    if (valid.length === 0) {
      // Nothing to insert; acks were already sent for invalid msgs above.
      return;
    }

    // Insert the valid batch. On failure, throw so CF Queue handles retries.
    // After max_retries the messages land in analytics-events-dlq.
    await insertRows(env, valid);

    // Ack all valid messages only after a successful insert.
    batch.ackAll();
  },
};
