-- 0031_form_submission_replies.sql
-- Item #4: AI auto-reply for form submissions.
-- Adds three columns to the existing form_submissions table:
--   reply_subject   - the subject line of the dispatched reply (or null)
--   reply_body      - the HTML body of the dispatched reply (or null)
--   replied_at      - ISO-8601 timestamp set when send-reply route fires Resend
--
-- The "draft-reply" route is stateless (returns AI draft to the UI without
-- writing to D1) — only the actual send mutates the row. Allows the user to
-- regenerate a draft as many times as they want without polluting the table.

ALTER TABLE form_submissions ADD COLUMN reply_subject TEXT;
ALTER TABLE form_submissions ADD COLUMN reply_body TEXT;
ALTER TABLE form_submissions ADD COLUMN replied_at TEXT;

-- Index for "show me unreplied submissions" inbox filter — partial index
-- on the hot path (replied_at IS NULL is the default state).
CREATE INDEX IF NOT EXISTS idx_form_submissions_unreplied
  ON form_submissions(site_id, created_at DESC) WHERE replied_at IS NULL;
