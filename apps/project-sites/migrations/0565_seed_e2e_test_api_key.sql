-- 0565_seed_e2e_test_api_key.sql
--
-- Seeds a throwaway E2E test org + user + membership + api_keys row so the
-- E2E suite's Pathway C auth (e2e/helpers/auth.ts seeds `E2E_API_KEY` into
-- ps_session → real session) actually AUTHENTICATES against prod. Without this
-- row, the seeded psk_test_ key matches nothing in api_keys → 401 → the entire
-- authed-admin E2E suite (all-flags, ui-polish, inline-editing, _fortress,
-- billing-flows, …) fails wholesale. middleware/auth.ts:46 verifies psk_live_/
-- psk_test_ keys via: SELECT … FROM api_keys WHERE hash=? AND revoked_at IS NULL
-- then sets userId=created_by, orgId=org_id.
--
-- `hash` = SHA-256(hex) of the E2E_API_KEY GH/get-secret value (psk_test_…).
-- Recompute if that secret rotates:
--   printf '%s' "$(get-secret E2E_API_KEY)" | shasum -a 256
--
-- SAFETY: test-org-scoped (no real customer data), revocable any time via
--   UPDATE api_keys SET revoked_at = datetime('now') WHERE id = 'e2e-test-key';
-- Idempotent (INSERT OR IGNORE) — safe to re-run / re-apply.

INSERT OR IGNORE INTO orgs (id, name, slug)
  VALUES ('e2e-test-org', 'E2E Test Org', 'e2e-test-org');

INSERT OR IGNORE INTO users (id, email, display_name)
  VALUES ('e2e-test-user', 'e2e@megabyte.space', 'E2E Test User');

INSERT OR IGNORE INTO memberships (id, org_id, user_id, role)
  VALUES ('e2e-test-membership', 'e2e-test-org', 'e2e-test-user', 'owner');

INSERT OR IGNORE INTO api_keys (id, org_id, created_by, name, prefix, hash, scopes_json)
  VALUES (
    'e2e-test-key',
    'e2e-test-org',
    'e2e-test-user',
    'E2E Test Key',
    'psk_test_',
    '54a12d4f730698a347f82b5669e00bb809b6b3dd9aa5c75a9cef0b77d22c05ae',
    '["*"]'
  );
