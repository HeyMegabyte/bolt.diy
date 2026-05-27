/**
 * Tenant D1 query helpers — scoped to this site's database.
 *
 * @remarks
 *  Every query goes through prepared statements (D1's parameterized API), never
 *  string concatenation. There is no `tenant_id` column anywhere; the
 *  TENANT_DB binding IS the tenant boundary.
 *
 *  Schema source of truth lives in `src/migrations/0001_init.sql`.
 *
 * @example
 *   const page = await getPageBySlug(c.env.SITE_DB, '/about');
 */
import type { D1Database } from '@cloudflare/workers-types';

export interface PageRow {
  slug: string;
  title: string;
  description: string;
  body_html: string;
  locale: string;
  updated_at: number;
  meta_json: string | null;
}

export interface ContactSubmission {
  name: string;
  email: string;
  subject: string;
  message: string;
  source: string;
  ip?: string;
}

export interface OrderRow {
  id: string;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  customer_email: string;
  stripe_payment_intent: string;
  application_fee_cents: number;
  metadata_json: string | null;
  created_at: number;
}

export interface SubscriberRow {
  email: string;
  locale: string;
  confirmed: number; // 0 | 1
  created_at: number;
}

export async function getPageBySlug(
  db: D1Database,
  slug: string,
  locale: string,
): Promise<PageRow | null> {
  // Try locale-specific first, then default locale, then any.
  const stmt = db.prepare(
    `SELECT slug, title, description, body_html, locale, updated_at, meta_json
       FROM pages
      WHERE slug = ?1 AND (locale = ?2 OR locale = 'en' OR locale = '')
      ORDER BY CASE WHEN locale = ?2 THEN 0 WHEN locale = 'en' THEN 1 ELSE 2 END
      LIMIT 1`,
  );
  return (await stmt.bind(slug, locale).first<PageRow>()) ?? null;
}

export async function listPagesForSitemap(db: D1Database): Promise<Pick<PageRow, 'slug' | 'updated_at' | 'locale'>[]> {
  const stmt = db.prepare(
    `SELECT slug, updated_at, locale
       FROM pages
      WHERE published = 1
      ORDER BY slug`,
  );
  const { results } = await stmt.all<Pick<PageRow, 'slug' | 'updated_at' | 'locale'>>();
  return results ?? [];
}

export async function insertContactSubmission(
  db: D1Database,
  s: ContactSubmission,
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO contact_submissions (id, name, email, subject, message, source, ip, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(id, s.name, s.email, s.subject, s.message, s.source, s.ip ?? null, Date.now())
    .run();
  return { id };
}

export async function insertOrder(
  db: D1Database,
  o: Omit<OrderRow, 'created_at'>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders (id, amount_cents, currency, status, customer_email,
                           stripe_payment_intent, application_fee_cents, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      o.id,
      o.amount_cents,
      o.currency,
      o.status,
      o.customer_email,
      o.stripe_payment_intent,
      o.application_fee_cents,
      o.metadata_json,
      Date.now(),
    )
    .run();
}

export async function updateOrderStatus(
  db: D1Database,
  stripePaymentIntent: string,
  status: OrderRow['status'],
): Promise<void> {
  await db
    .prepare(`UPDATE orders SET status = ?1 WHERE stripe_payment_intent = ?2`)
    .bind(status, stripePaymentIntent)
    .run();
}

export async function findOrderByPaymentIntent(
  db: D1Database,
  stripePaymentIntent: string,
): Promise<OrderRow | null> {
  return (
    (await db
      .prepare(
        `SELECT id, amount_cents, currency, status, customer_email,
                stripe_payment_intent, application_fee_cents, metadata_json, created_at
           FROM orders WHERE stripe_payment_intent = ?1 LIMIT 1`,
      )
      .bind(stripePaymentIntent)
      .first<OrderRow>()) ?? null
  );
}

export async function upsertNewsletterSubscriber(
  db: D1Database,
  email: string,
  locale: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO newsletter_subscribers (email, locale, confirmed, created_at)
       VALUES (?1, ?2, 0, ?3)
       ON CONFLICT(email) DO UPDATE SET locale = excluded.locale`,
    )
    .bind(email.toLowerCase(), locale, Date.now())
    .run();
}

/**
 * Dedupe webhook events at the tenant boundary. Returns `true` if the event id
 * is new (and was recorded); `false` if it has already been processed. Pair
 * with the standard "idempotency = primary key + unique constraint" pattern.
 */
export async function recordWebhookEventIfNew(
  db: D1Database,
  source: 'stripe' | 'resend',
  eventId: string,
): Promise<boolean> {
  try {
    await db
      .prepare(
        `INSERT INTO webhook_events (event_id, source, received_at) VALUES (?1, ?2, ?3)`,
      )
      .bind(eventId, source, Date.now())
      .run();
    return true;
  } catch (err) {
    // UNIQUE constraint failure → already processed.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('unique')) return false;
    throw err;
  }
}
