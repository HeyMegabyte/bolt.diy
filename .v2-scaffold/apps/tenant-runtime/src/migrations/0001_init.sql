-- Tenant D1 init schema. ONE D1 PER TENANT — no tenant_id column anywhere.
-- The binding IS the tenant boundary (ADR-0008).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL,
  meta_json TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (slug, locale)
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL,
  author TEXT,
  cover_image TEXT,
  tags_json TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (slug, locale)
);

CREATE TABLE IF NOT EXISTS contact_submissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','refunded')),
  customer_email TEXT NOT NULL,
  stripe_payment_intent TEXT NOT NULL UNIQUE,
  application_fee_cents INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  email TEXT PRIMARY KEY,
  display_name TEXT,
  stripe_customer_id TEXT,
  locale TEXT NOT NULL DEFAULT 'en',
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_order_at INTEGER
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  email TEXT PRIMARY KEY,
  locale TEXT NOT NULL DEFAULT 'en',
  confirmed INTEGER NOT NULL DEFAULT 0,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT NOT NULL,
  source TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, source)
);
