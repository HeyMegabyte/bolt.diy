-- Migration 0505 — Site DNA Taste Graph
-- Per [[feature-flags]]: new feature ships behind flag `site_dna_taste_graph`
-- (enabled=0, rollout=0, stage='experimental').

-- ── site_dna_feedback ──────────────────────────────────────────────────────
-- Every accept/reject/edit action on a generated component is recorded here.
-- Vectorize index `site-dna-{orgId}` receives BGE embeddings for semantic
-- ranking. The build orchestrator reads top-K accepted patterns at generation
-- time as a soft preference signal (not enforced, treated as prior).

CREATE TABLE IF NOT EXISTS site_dna_feedback (
  id                TEXT    PRIMARY KEY,  -- UUID
  org_id            TEXT    NOT NULL,
  site_id           TEXT    NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  component_id      TEXT    NOT NULL,     -- e.g. "hero", "testimonials", "pricing"
  component_class   TEXT    NOT NULL,     -- semantic class: "hero"|"cta"|"social-proof"|"faq"|...
  action            TEXT    NOT NULL CHECK(action IN ('accept','reject','edit')),
  -- Raw context object persisted as JSON: {slot, variant, industry, previous_action, ...}
  context_json      TEXT    NOT NULL DEFAULT '{}',
  -- 768-dim BGE embedding of component_id + component_class + context_json (serialised)
  -- stored as a hex string when Vectorize is unavailable so we can back-fill later.
  embedding_hex     TEXT,
  vectorize_id      TEXT,                 -- id upserted into Vectorize index
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  deleted_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_site_dna_feedback_org_id   ON site_dna_feedback(org_id);
CREATE INDEX IF NOT EXISTS idx_site_dna_feedback_site_id  ON site_dna_feedback(site_id);
CREATE INDEX IF NOT EXISTS idx_site_dna_feedback_action   ON site_dna_feedback(action);
CREATE INDEX IF NOT EXISTS idx_site_dna_feedback_class    ON site_dna_feedback(component_class);
