-- AN5 breakdowns (completion) — the event-type breakdown column the first
-- breakdowns migration (0577) left out. With this, analytics_daily has FULL
-- parity with getTrafficSummary's breakdowns (paths/channel/device/country/type),
-- so AN3 can serve the entire owner summary from the rollup (O(days)). Additive,
-- nullable, populated by rollupAnalyticsDaily's UPDATE pass.

ALTER TABLE analytics_daily ADD COLUMN by_type_json TEXT;  -- [{type,count}] over ALL events
