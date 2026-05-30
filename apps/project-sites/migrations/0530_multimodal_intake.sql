-- Migration 0530 — Multimodal Intake (idea #18)
-- Additive only. Stores photo+voice intake submissions on generated-site /book
-- pages. Feeds native_booking_engine (booking_id) when that flag is on.
-- Also registers a drop-in intake-booking CTA section in section_marketplace
-- so the generator can place it on /book pages.

CREATE TABLE IF NOT EXISTS intake_submissions (
  id                TEXT PRIMARY KEY,                    -- UUID
  site_id           TEXT NOT NULL,                       -- owning site
  photo_url         TEXT,                                -- uploaded problem photo (R2-relayed URL)
  voice_transcript  TEXT,                                -- Whisper/Deepgram transcript of the voice note
  extracted_intent  TEXT NOT NULL,                       -- JSON: { intent, suggestedService, suggestedFields }
  urgency           INTEGER NOT NULL DEFAULT 0           -- 0 (routine) .. 100 (emergency)
                    CHECK(urgency BETWEEN 0 AND 100),
  booking_id        TEXT,                                -- proposed booking when native_booking_engine on
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  deleted_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_intake_submissions_site
  ON intake_submissions (site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_urgency
  ON intake_submissions (site_id, urgency);

-- Register the drop-in intake-booking section in the marketplace catalog so the
-- generator can place it on /book pages for service industries. One row per
-- booking-relevant industry (salon, medical, lawyer); slot = 'cta'.
INSERT OR IGNORE INTO section_marketplace
  (id, industry, name, slot, html_template, css_template, data_schema, quality_score, author)
VALUES
  ('smp-salon-intake-booking',
   'salon', 'Multimodal Intake — photo + voice → booking', 'cta',
   '<section class="smp-intake" data-multimodal-intake data-site-id="{{site_id}}" data-booking-endpoint="/api/sites/{{site_id}}/intake"><h2>{{title}}</h2><p>{{description}}</p></section>',
   '.smp-intake{padding:4rem 1.5rem;max-width:48rem;margin:0 auto;text-align:center}',
   '{"type":"object","required":["site_id","title","description"],"properties":{"site_id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"}}}',
   9.0, 'projectsites'),
  ('smp-medical-intake-booking',
   'medical', 'Multimodal Intake — photo + voice → booking', 'cta',
   '<section class="smp-intake" data-multimodal-intake data-site-id="{{site_id}}" data-booking-endpoint="/api/sites/{{site_id}}/intake"><h2>{{title}}</h2><p>{{description}}</p></section>',
   '.smp-intake{padding:4rem 1.5rem;max-width:48rem;margin:0 auto;text-align:center}',
   '{"type":"object","required":["site_id","title","description"],"properties":{"site_id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"}}}',
   9.0, 'projectsites'),
  ('smp-lawyer-intake-booking',
   'lawyer', 'Multimodal Intake — photo + voice → booking', 'cta',
   '<section class="smp-intake" data-multimodal-intake data-site-id="{{site_id}}" data-booking-endpoint="/api/sites/{{site_id}}/intake"><h2>{{title}}</h2><p>{{description}}</p></section>',
   '.smp-intake{padding:4rem 1.5rem;max-width:48rem;margin:0 auto;text-align:center}',
   '{"type":"object","required":["site_id","title","description"],"properties":{"site_id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"}}}',
   9.0, 'projectsites');
