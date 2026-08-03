-- Persist the Settings → General brand + locale fields the FE already sends to
-- PUT /sites/:id/ai-settings. They were silently dropped by the worker allow-list
-- and never returned by the GET → edits showed a "Saved" toast but vanished on
-- reload (a lying-UI). Additive columns on the existing ai_site_settings table
-- (the same table the sibling fields chat_persona / brand_tone / contact_email use).
ALTER TABLE ai_site_settings ADD COLUMN brand_primary TEXT;
ALTER TABLE ai_site_settings ADD COLUMN brand_accent TEXT;
ALTER TABLE ai_site_settings ADD COLUMN timezone TEXT;
ALTER TABLE ai_site_settings ADD COLUMN default_locale TEXT;
