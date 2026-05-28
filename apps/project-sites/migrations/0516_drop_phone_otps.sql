-- Migration: 0516_drop_phone_otps
-- Drops the orphaned phone_otps table and its index (phone feature removed
-- in commit b555680 — Twilio SMS / phone OTP endpoints removed). The
-- `users.phone` column is intentionally left in place: dropping a column
-- from an existing D1 table requires a full table-copy migration that is
-- riskier than the benefit. The column always stores NULL and is excluded
-- from all SELECT / INSERT paths (see CLAUDE.md § Known Issues #8).
-- D1 Time Travel can restore the table for 30 days if needed.

DROP INDEX IF EXISTS idx_phone_otps_phone;
DROP TABLE IF EXISTS phone_otps;
