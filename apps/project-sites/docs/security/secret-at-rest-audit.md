# Secret-at-Rest Audit + Key-Rotation Runbook

> Ledger item #75. Audit of the AES-GCM encryption-at-rest layer + the
> zero-downtime rotation story for `MCP_ENCRYPTION_KEY`.
> Last audited: 2026-06-28 (loop fire).

## 1. What is encrypted at rest

Every user-supplied secret stored in D1 is AES-GCM encrypted via
`src/services/ai_crypto.ts` (`encrypt`/`decrypt`). Callers:

- **`ai_env_vars.ts`** — per-org/site/MCP env vars (`ai_env_vars.value_encrypted`).
- **MCP OAuth tokens / CF credentials** — `mcp_connections` token blobs.
- **`google_drive.ts`** — Drive OAuth tokens.
- **`outbound_webhooks.ts`** — webhook signing material.
- **`social_account_ctx.ts`** — social-platform tokens.

All route through the single `encrypt`/`decrypt` seam — no bespoke crypto.

## 2. Crypto properties (verified)

| Property | Status | Evidence |
|---|---|---|
| Algorithm | ✅ AES-256-GCM (authenticated) | `importRawKey` → `{name:'AES-GCM'}`, 32-byte key |
| Fresh IV per write (no nonce reuse) | ✅ | `crypto.getRandomValues(new Uint8Array(12))` per `encrypt` call; test "fresh IV per call" |
| Blob format | ✅ `base64(iv ‖ ciphertext)`, 12-byte IV prefix | `encrypt`/`decryptWithKey` |
| Tamper rejection | ✅ GCM auth tag | test "REJECTS a tampered ciphertext" |
| Wrong-key rejection | ✅ | test "REJECTS decryption under a different key" |
| Key non-extractable | ✅ `importKey(..., false, ...)` — cannot be exported from the isolate | `importRawKey` |
| Key length validated | ✅ throws unless decodes to exactly 32 bytes | `importRawKey` |
| Decrypt failure audited | ✅ `event: 'decrypt_failed'` | `ai_env_vars.ts` |
| Plaintext never logged / never in blob | ✅ | test "ciphertext must not leak plaintext"; decrypted values hidden in list responses |

The key is provided as a Worker **secret** (`MCP_ENCRYPTION_KEY`, base64 of 32
random bytes), never committed. Per repo CLAUDE.md it is **Tier 1.5 data-at-rest**
— rotating it without re-encryption destroys persisted data, so rotation MUST
follow the runbook below.

## 3. Zero-downtime rotation story

`decrypt` supports an optional **`MCP_ENCRYPTION_KEY_OLD`** fallback: it tries the
primary key first and, only on failure, retries with the old key. This makes
rotation lazy + zero-downtime — no big-bang re-encryption migration required, no
read outage.

### Runbook

1. **Mint** a new 32-byte key:
   `openssl rand -base64 32` → `NEW_KEY`.
2. **Read** the current key value (the soon-to-be-old one) → `OLD_KEY`
   (`npx wrangler secret list` shows presence; the value comes from your secret
   store / `get-secret MCP_ENCRYPTION_KEY`).
3. **Deploy with both** (one command each, production):
   ```bash
   printf '%s' "$NEW_KEY" | npx wrangler secret put MCP_ENCRYPTION_KEY     --env production
   printf '%s' "$OLD_KEY" | npx wrangler secret put MCP_ENCRYPTION_KEY_OLD --env production
   ```
   Now: NEW blobs encrypt under `NEW_KEY`; OLD blobs still decrypt via the
   `MCP_ENCRYPTION_KEY_OLD` fallback. **Zero downtime.**
4. **Re-encrypt lazily or eagerly.** Every write of a secret (`ai_env_vars`
   upsert, OAuth refresh) already re-`encrypt`s under the primary key, so rows
   migrate as they are touched. To force-migrate all rows, decrypt+re-encrypt
   each `*_encrypted` / token column once (a one-off admin pass), which writes
   them under `NEW_KEY`.
5. **Drop the old key** once no row remains under it:
   ```bash
   npx wrangler secret delete MCP_ENCRYPTION_KEY_OLD --env production
   ```
   After this, a blob still under the old key fails closed (audited
   `decrypt_failed`) rather than silently returning garbage.

### Rollback

If step 3 misbehaves, swap the two secret values back (old as primary, new as
fallback) and redeploy — both keys decrypt during the overlap, so no data is lost.

## 4. Residual risks / non-goals

- **Re-keying does NOT re-IV existing blobs** until they are rewritten — that is
  fine (each blob already has its own random IV; rotation changes the *key*, not
  the per-blob IV).
- **No HSM / KMS** — the key lives as a Worker secret in the isolate, decrypted in
  memory per request. Acceptable for this tier; a future hardening could front it
  with Cloudflare Keyless / an external KMS.
- **`MANIFEST_SIGNING_SECRET` falls back to `MCP_ENCRYPTION_KEY`** when unset
  (manifest signing) — if you rotate `MCP_ENCRYPTION_KEY` AND rely on that
  fallback, set an explicit `MANIFEST_SIGNING_SECRET` first so manifest
  signatures stay stable across the rotation.

## See

- `src/services/ai_crypto.ts` — the encrypt/decrypt seam + rotation fallback
- `src/__tests__/ai_crypto.test.ts` — 9 security-property + rotation tests
- `rules/secret-provisioning.md` · `rules/secret-auto-provisioning.md` (Tier 1.5)
