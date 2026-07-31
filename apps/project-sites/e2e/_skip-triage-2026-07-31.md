# E2E Skip/Fixme Triage — Pass 7 (2026-07-31)

Generated from: `apps/project-sites/e2e/`  
Total hits: 135 lines in skip-triage.txt

---

## Summary Counts

| Class | Description | Count |
|-------|-------------|-------|
| (a) | Conditional runtime guards — KEEP | 24 |
| (b) | Hard-skipped with dated TODO — KEEP, list | 0 |
| (c) | Hard-skipped stale / no runtime condition — DELETE candidates | 107 |
| (d) | Wrongly-formed `test.skip(titleString)` — REVIVE candidates | 2 |

---

## Class (a) — Conditional runtime guards (KEEP)

These use `!envVar`, `flag is off`, or feature-flag checks — correct TDD gates.

### Feature flag gates (inbox / copilot)
- `e2e/inbox/inbox.spec.ts:52` — `unified_inbox flag is off — skipping stats test`
- `e2e/inbox/inbox.spec.ts:63` — `unified_inbox flag is off`
- `e2e/inbox/inbox.spec.ts:80` — `unified_inbox flag is off`
- `e2e/inbox/inbox.spec.ts:95` — `unified_inbox flag is off`
- `e2e/inbox/inbox.spec.ts:107` — `unified_inbox flag is off`
- `e2e/inbox/inbox.spec.ts:120` — `unified_inbox flag appears to be on — gate not shown`
- `e2e/inbox/inbox.spec.ts:139` — `unified_inbox flag is off`
- `e2e/inbox/inbox.spec.ts:155` — `unified_inbox flag is off`
- `e2e/copilot/copilot.spec.ts:158` — `copilot flag is off`
- `e2e/copilot/copilot.spec.ts:170` — `copilot flag is off`
- `e2e/copilot/copilot.spec.ts:184` — `copilot flag is off`

### Auth / credential guards
- `e2e/logs/logs-explorer.spec.ts:58` — `TEST_AUTH_TOKEN not set`
- `e2e/logs/logs-explorer.spec.ts:69` — `TEST_AUTH_TOKEN not set`
- `e2e/logs/logs-explorer.spec.ts:82` — `TEST_AUTH_TOKEN not set`
- `e2e/logs/logs-explorer.spec.ts:94` — `TEST_AUTH_TOKEN not set`
- `e2e/logs/logs-explorer.spec.ts:106` — `TEST_AUTH_TOKEN not set`
- `e2e/logs/logs-explorer.spec.ts:124` — `TEST_AUTH_TOKEN not set`
- `e2e/domain-stack/domain-stack.spec.ts:58` — conditional env guard
- `e2e/domain-stack/domain-stack.spec.ts:69` — conditional env guard

### Service credential guards
- `e2e/voice/voice-sms.spec.ts:38` — `!TWILIO_PRESENT`
- `e2e/voice/voice-sms.spec.ts:59` — `!TWILIO_PRESENT`
- `e2e/voice/voice-sms.spec.ts:80` — `!TWILIO_PRESENT`

### Other runtime conditional
- `e2e/collab.spec.ts:46` — `!process.env.E2E_API_KEY` style guard
- `e2e/collab.spec.ts:55` — `!process.env.E2E_API_KEY` style guard

---

## Class (b) — Hard-skipped with dated TODO (KEEP, list)

**Count: 0.** No hits with date-stamped TODO/FIXME comment in the skip reason.

---

## Class (c) — Hard-skipped stale / no runtime condition (DELETE candidates)

These use `test.skip(true, '...')` with a static string reason — not gated on any runtime condition. Most are in the adversarial suites which were bulk-skipped during a previous pass.

**Top 10 DELETE candidates (highest priority):**

1. `e2e/confidence-ui.spec.ts:20` — `External network unavailable` (static, never true in CI)
2. `e2e/rebuild-and-research.spec.ts:222` — `External network unavailable — skipping production research.json test` (static)
3. `e2e/ai-endpoints-ide.spec.ts:28` — no runtime condition
4. `e2e/ai-endpoints-ide.spec.ts:39` — no runtime condition
5. `e2e/ai-endpoints-ide.spec.ts:56` — no runtime condition
6. `e2e/ai-endpoints-ide.spec.ts:70` — no runtime condition
7. `e2e/ai-endpoints-ide.spec.ts:86` — no runtime condition
8. `e2e/ai-endpoints-ide.spec.ts:100` — no runtime condition
9. `e2e/adversarial/shell-stress.spec.ts:350` — mass-skip in adversarial suite
10. `e2e/adversarial/overlay-and-focus.spec.ts:91` — mass-skip in adversarial suite

**Bulk-skip files (adversarial suite — each file has 10–40 stale `test.skip(true)` hits):**
- `e2e/adversarial/form-and-dirty-state.spec.ts` — 18 hits (lines 80–619)
- `e2e/adversarial/sections-ai.spec.ts` — 39 hits (lines 109–705)
- `e2e/adversarial/sections-forms.spec.ts` — 28 hits (lines 109–659)
- `e2e/adversarial/sections-data.spec.ts` — 17 hits (lines 115–714)
- `e2e/adversarial/overlay-and-focus.spec.ts` — 11 hits (lines 91–555)

Full adversarial DELETE count: **103 tests** across those 5 files. Each `test.skip(true, ...)` should either be un-skipped (if the feature is live) or removed with a `// TODO: revive when <feature> is enabled` comment.

---

## Class (d) — Wrongly-formed `test.skip(titleString)` (REVIVE candidates)

These call `test.skip('title string', async ({ page }) => { ... })` — the second argument being an async function means Playwright treats it as a test body, not a skip. The test is actually registered and skipped correctly in newer Playwright versions but the intent was to mark it pending. These should be converted to proper `test('title', async () => { ... })` with auth fixture, or to `test.skip(() => !condition, 'reason')`.

1. `e2e/site-mcp/site-mcp.spec.ts:116` — `test.skip('Admin /admin/sites/:id/mcp-server renders tool list (requires auth)', ...)` — REVIVE: feature is live, auth available via `E2E_API_KEY`
2. `e2e/branches/branches.spec.ts:82` — `test.skip('Admin /admin/sites/:id/branches renders branch list (requires auth)', ...)` — REVIVE: branches feature is live

---

## TASK 1 Result (for record)

**Before fix (Pass 6 Test 4):** `waitUntil: 'domcontentloaded'` + `waitForTimeout(1500)` caused `net::ERR_ABORTED` under `--repeat-each=2 --workers=2` because the 302 redirect from `/api/auth/google/callback?error=access_denied` raced with `domcontentloaded`.

**After fix (Pass 7):** SPA prime → `waitUntil: 'load'` in try/catch (absorbs ERR_ABORTED) → `page.waitForURL(!startsWith('/api/'))` → `expect.poll()` on `document.body.innerHTML.length`.

**Verification:** `--repeat-each=3 --workers=2` → **3/3 passed** (8.9s).
