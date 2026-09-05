-- Lead Scanner contact enrichment (#9): capture website / phone / socials for
-- each scanned lead so the Super-Admin table can render a full contact block +
-- brand social icons. `email` already exists (0569). All additive + nullable —
-- a two-way-door migration (drop-to-revert, no data transform). Populated at
-- scan time from OSM contact:* tags AND on demand by the /enrich endpoint
-- (free homepage parse + flag-gated paid provider). socials_json is a JSON
-- object { network-key -> profile URL }, e.g. {"facebook":"https://facebook.com/x"}.
ALTER TABLE scanned_leads ADD COLUMN phone TEXT;
ALTER TABLE scanned_leads ADD COLUMN website TEXT;
ALTER TABLE scanned_leads ADD COLUMN socials_json TEXT;
ALTER TABLE scanned_leads ADD COLUMN enriched_at TEXT;
