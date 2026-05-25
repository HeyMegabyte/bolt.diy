-- 0043_snapshot_vision_score.sql
--
-- Adds Workers AI Llama 4 Scout vision scoring to the snapshot quality matrix.
-- After the Browser Rendering screenshot lands in R2, a follow-up step pipes the
-- PNG into `@cf/meta/llama-4-scout-17b-16e-instruct` and asks for a JSON rubric:
--   layout, typography, color, imagery, whitespace, distinctiveness, overall, notes
--
-- All columns are NULLable — when the model is unavailable, hits a transient
-- error, or returns unparseable JSON the row still writes with whatever subset
-- of metrics resolved. `vision_notes` carries either the model's free-text
-- critique or a sentinel like `parse_failed` / `model_unavailable` for
-- post-hoc triage.
--
-- See: src/workflows/snapshot-quality.ts step `ai-visual-score`.

ALTER TABLE snapshot_metrics ADD COLUMN vision_overall REAL;
ALTER TABLE snapshot_metrics ADD COLUMN vision_scores_json TEXT;
ALTER TABLE snapshot_metrics ADD COLUMN vision_notes TEXT;
ALTER TABLE snapshot_metrics ADD COLUMN vision_model TEXT;

CREATE INDEX IF NOT EXISTS idx_snapshot_metrics_vision_overall
  ON snapshot_metrics(vision_overall DESC);
