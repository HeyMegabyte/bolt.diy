-- AN5 breakdowns — per-day dimension breakdowns on the analytics_daily rollup.
-- Each column holds a JSON array of {label,count} (or {path,count}) for that
-- site+day, populated by rollupAnalyticsDaily's per-dimension UPDATE pass. This
-- lets the owner summary serve "last N days" breakdowns from the rollup (O(days))
-- instead of re-scanning visitor_events. Nullable + additive (safe two-way door).

ALTER TABLE analytics_daily ADD COLUMN top_paths_json  TEXT;  -- [{path,count}] top pages by views
ALTER TABLE analytics_daily ADD COLUMN by_channel_json TEXT;  -- [{label,count}] direct/organic/social/…
ALTER TABLE analytics_daily ADD COLUMN by_device_json  TEXT;  -- [{label,count}] mobile/desktop/tablet
ALTER TABLE analytics_daily ADD COLUMN by_country_json TEXT;  -- [{label,count}] cf.country
