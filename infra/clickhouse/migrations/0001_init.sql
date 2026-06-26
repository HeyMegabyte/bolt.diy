-- ============================================================
-- Migration 0001 — Initial analytics schema
-- Database: analytics
-- Engine:   MergeTree family (single-node; swap to ReplicatedMergeTree
--           when adding replicas)
--
-- Retention policy: all tables carry a TTL comment.
-- Adjust the TTL expression per table before applying in production.
-- Apply via:
--   clickhouse-client --host <host> --user default --password <pw> \
--     --database analytics < infra/clickhouse/migrations/0001_init.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS analytics;

USE analytics;

-- ------------------------------------------------------------
-- events — generic event stream (catch-all)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events
(
    tenant_id       String,
    site_id         String,
    event_name      String,
    anonymous_id    String        DEFAULT '',
    user_id         String        DEFAULT '',
    session_id      String        DEFAULT '',
    properties      String        DEFAULT '{}',  -- JSON blob
    ip_country      String        DEFAULT '',
    user_agent      String        DEFAULT '',
    referrer        String        DEFAULT '',
    timestamp       DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, site_id, timestamp)
-- TTL: retain 24 months; adjust per data-retention policy
-- TTL timestamp + INTERVAL 24 MONTH DELETE
SETTINGS index_granularity = 8192;

-- ------------------------------------------------------------
-- page_views — deduplicated page view stream
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_views
(
    tenant_id       String,
    site_id         String,
    page_url        String,
    page_path       String,
    page_title      String        DEFAULT '',
    referrer        String        DEFAULT '',
    anonymous_id    String        DEFAULT '',
    user_id         String        DEFAULT '',
    session_id      String        DEFAULT '',
    duration_ms     UInt32        DEFAULT 0,
    scroll_depth    UInt8         DEFAULT 0,   -- 0-100 %
    ip_country      String        DEFAULT '',
    device_type     String        DEFAULT '',  -- desktop|mobile|tablet
    browser         String        DEFAULT '',
    timestamp       DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, site_id, timestamp)
-- TTL: retain 24 months
-- TTL timestamp + INTERVAL 24 MONTH DELETE
SETTINGS index_granularity = 8192;

-- ------------------------------------------------------------
-- conversions — goal completions (form submit, CTA click, etc.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversions
(
    tenant_id       String,
    site_id         String,
    goal_name       String,
    goal_value      Float64       DEFAULT 0,
    currency        String        DEFAULT 'USD',
    anonymous_id    String        DEFAULT '',
    user_id         String        DEFAULT '',
    session_id      String        DEFAULT '',
    page_url        String        DEFAULT '',
    attribution     String        DEFAULT '{}',  -- JSON: source/medium/campaign
    timestamp       DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, site_id, timestamp)
-- TTL: retain 36 months (revenue-relevant)
-- TTL timestamp + INTERVAL 36 MONTH DELETE
SETTINGS index_granularity = 8192;

-- ------------------------------------------------------------
-- sessions — aggregated session summaries (one row per session)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions
(
    tenant_id           String,
    site_id             String,
    session_id          String,
    anonymous_id        String        DEFAULT '',
    user_id             String        DEFAULT '',
    started_at          DateTime64(3),
    ended_at            DateTime64(3),
    duration_ms         UInt32        DEFAULT 0,
    page_view_count     UInt16        DEFAULT 0,
    event_count         UInt16        DEFAULT 0,
    conversion_count    UInt8         DEFAULT 0,
    entry_page          String        DEFAULT '',
    exit_page           String        DEFAULT '',
    referrer            String        DEFAULT '',
    utm_source          String        DEFAULT '',
    utm_medium          String        DEFAULT '',
    utm_campaign        String        DEFAULT '',
    ip_country          String        DEFAULT '',
    device_type         String        DEFAULT '',
    browser             String        DEFAULT '',
    timestamp           DateTime64(3) DEFAULT now64(3)  -- = started_at for partitioning
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, site_id, session_id, timestamp)
-- TTL: retain 24 months
-- TTL timestamp + INTERVAL 24 MONTH DELETE
SETTINGS index_granularity = 8192;

-- ------------------------------------------------------------
-- usage_metering — API call / resource consumption (billing inputs)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_metering
(
    tenant_id       String,
    resource_type   String,   -- 'ai_tokens'|'api_calls'|'storage_bytes'|'bandwidth_bytes'
    resource_key    String    DEFAULT '',  -- model name, endpoint, bucket, etc.
    quantity        Float64   DEFAULT 0,
    unit            String    DEFAULT '',  -- 'tokens'|'requests'|'bytes'
    cost_usd        Float64   DEFAULT 0,
    metadata        String    DEFAULT '{}',
    timestamp       DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, resource_type, timestamp)
-- TTL: retain 36 months (billing audit trail)
-- TTL timestamp + INTERVAL 36 MONTH DELETE
SETTINGS index_granularity = 8192;

-- ------------------------------------------------------------
-- social_post_events — social publishing pipeline events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_post_events
(
    tenant_id       String,
    site_id         String,
    platform        String,   -- 'twitter'|'linkedin'|'instagram'|'facebook'|etc.
    post_id         String    DEFAULT '',
    event_type      String,   -- 'scheduled'|'published'|'failed'|'deleted'|'engagement'
    impressions     UInt32    DEFAULT 0,
    engagements     UInt32    DEFAULT 0,
    clicks          UInt32    DEFAULT 0,
    shares          UInt32    DEFAULT 0,
    error_message   String    DEFAULT '',
    metadata        String    DEFAULT '{}',
    timestamp       DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, site_id, platform, timestamp)
-- TTL: retain 18 months
-- TTL timestamp + INTERVAL 18 MONTH DELETE
SETTINGS index_granularity = 8192;

-- ------------------------------------------------------------
-- ai_workflow_events — AI site generation + prompt execution
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_workflow_events
(
    tenant_id       String,
    site_id         String,
    workflow_id     String    DEFAULT '',
    step_name       String,
    model           String    DEFAULT '',
    prompt_version  String    DEFAULT '',
    input_tokens    UInt32    DEFAULT 0,
    output_tokens   UInt32    DEFAULT 0,
    latency_ms      UInt32    DEFAULT 0,
    status          String,   -- 'started'|'completed'|'failed'|'retried'
    error_code      String    DEFAULT '',
    metadata        String    DEFAULT '{}',
    timestamp       DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, site_id, workflow_id, timestamp)
-- TTL: retain 12 months
-- TTL timestamp + INTERVAL 12 MONTH DELETE
SETTINGS index_granularity = 8192;

-- ------------------------------------------------------------
-- support_events — Chatwoot / support ticket lifecycle
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_events
(
    tenant_id       String,
    conversation_id String    DEFAULT '',
    contact_id      String    DEFAULT '',
    agent_id        String    DEFAULT '',
    event_type      String,   -- 'created'|'assigned'|'resolved'|'reopened'|'message_sent'|etc.
    channel         String    DEFAULT '',  -- 'email'|'chat'|'api'
    resolution_time_ms UInt32 DEFAULT 0,
    csat_score      Int8      DEFAULT -1, -- -1 = not rated, 1-5 scale
    metadata        String    DEFAULT '{}',
    timestamp       DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, conversation_id, timestamp)
-- TTL: retain 24 months
-- TTL timestamp + INTERVAL 24 MONTH DELETE
SETTINGS index_granularity = 8192;

-- ------------------------------------------------------------
-- billing_events — Stripe webhook / subscription lifecycle
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_events
(
    tenant_id       String,
    event_type      String,   -- 'subscription.created'|'invoice.paid'|'charge.failed'|etc.
    stripe_event_id String    DEFAULT '',
    plan_id         String    DEFAULT '',
    amount_cents    Int64     DEFAULT 0,
    currency        String    DEFAULT 'usd',
    status          String    DEFAULT '',
    metadata        String    DEFAULT '{}',
    timestamp       DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (tenant_id, event_type, timestamp)
-- TTL: retain 84 months (7 years — financial record-keeping)
-- TTL timestamp + INTERVAL 84 MONTH DELETE
SETTINGS index_granularity = 8192;
