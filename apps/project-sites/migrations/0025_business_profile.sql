-- 0025 — Business profile fields on `sites`.
--
-- The Business tab in the admin UI collects far more than the original
-- `business_name` + `slug` pair. `business_address` and `business_phone`
-- already exist (0001 initial schema), so we only add the four NEW columns
-- the UI surfaces:
--
--   - `business_website` — owner-supplied URL of the source business site.
--     Stored verbatim (no URL canonicalisation here — that's the build's job)
--     and shown back as a clickable link in the dashboard "Business" tab.
--   - `original_prompt` — the free-text site-building prompt the owner
--     typed into the search/create flow. Persisting it lets `Reset` re-run
--     the build with the exact original brief and lets the AI orchestrator
--     reference the operator's stated intent.
--   - `logo_url` — R2 path (or external URL) of the logo asset used by the
--     build. Surfaces in the Business tab as a preview chip + lets the owner
--     swap it without re-uploading by pasting a new URL.
--   - `app_icon_url` — R2 path (or external URL) of the square app icon /
--     favicon source. Separate from `logo_url` because real-favicon-generator
--     expects a square master ≥ 512×512, while the brand logo is often a
--     horizontal wordmark.
--
-- All four are nullable so existing rows pass the migration unchanged; the
-- UI surfaces an empty-state when null and lets the owner fill them in.

ALTER TABLE sites ADD COLUMN business_website TEXT;
ALTER TABLE sites ADD COLUMN original_prompt TEXT;
ALTER TABLE sites ADD COLUMN logo_url TEXT;
ALTER TABLE sites ADD COLUMN app_icon_url TEXT;
