-- Add missing columns the /api/sites/:siteId/ai-settings handler selects.
-- The handler SELECTs contact_email + brand_tone but neither column existed,
-- which caused 500s on every load of the General settings tab.
ALTER TABLE ai_site_settings ADD COLUMN contact_email TEXT;
ALTER TABLE ai_site_settings ADD COLUMN brand_tone TEXT;
