-- 0537_review_link_password.sql
-- Optional password protection for shareable review/approval ("Share") links.
-- A reviewer-facing link can require a password before the review page reveals
-- the site. We store a PBKDF2-SHA256 hash + per-link random salt — never the
-- plaintext. NULL password_hash => the link is open (no password gate).
--
-- Additive only (ALTER ADD COLUMN) — existing review_tokens rows stay open.
ALTER TABLE review_tokens ADD COLUMN password_hash TEXT;
ALTER TABLE review_tokens ADD COLUMN password_salt TEXT;
