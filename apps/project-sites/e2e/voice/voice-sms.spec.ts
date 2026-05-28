/**
 * @module e2e/voice/voice-sms
 * @description E2E tests for Twilio Voice / SMS features (flag-gated `voice_editing`).
 *
 * Covers VOICE-01..VOICE-04.
 *
 * ⚠️  BLOCKED — All VOICE-* rows remain unchecked.
 *     Reason: Requires live Twilio credentials to provision a real phone number.
 *     Required env vars:
 *       - TWILIO_ACCOUNT_SID  → https://console.twilio.com/us1/account/keys-credentials/api-keys
 *       - TWILIO_AUTH_TOKEN   → https://console.twilio.com/us1/account/keys-credentials/api-keys
 *       - TWILIO_PHONE_NUMBER → https://console.twilio.com/us1/develop/phone-numbers/manage/active
 *     Once secrets are available, set STUB_VOICE=0 and remove this blocker comment.
 *
 * Until then, every test verifies only the AUTH GUARD (401 without credentials)
 * so the spec file is valid TypeScript and the suite still runs hermetically.
 *
 * @packageDocumentation
 */

import { test, expect } from '../fixtures.js';

const TWILIO_PRESENT =
  !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;

// ---------------------------------------------------------------------------
// VOICE-01 — Reserve Twilio phone number
// BLOCKED: needs TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
// ---------------------------------------------------------------------------
test.describe('VOICE-01 — Reserve Twilio phone number', () => {
  test('POST /api/voice/phone-numbers returns 401 without auth', async ({ page }) => {
    const res = await page.request.post('/api/voice/phone-numbers', {
      data: { area_code: '201', site_id: 'some-id' },
    });
    expect(res.status()).toBe(401);
  });

  test.skip(!TWILIO_PRESENT, 'BLOCKED: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — https://console.twilio.com/us1/account/keys-credentials/api-keys');
  test('POST /api/voice/phone-numbers with live Twilio returns 200', async ({ authedPage: page }) => {
    const res = await page.request.post('/api/voice/phone-numbers', {
      data: { area_code: '201', site_id: 'e2e-voice-test' },
    });
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// VOICE-02 — Configure inbound voice agent prompt
// BLOCKED: needs TWILIO_* secrets
// ---------------------------------------------------------------------------
test.describe('VOICE-02 — Configure inbound voice agent prompt', () => {
  test('PUT /api/voice/config returns 401 without auth', async ({ page }) => {
    const res = await page.request.put('/api/voice/config', {
      data: { site_id: 'some-id', prompt: 'Hello' },
    });
    expect(res.status()).toBe(401);
  });

  test.skip(!TWILIO_PRESENT, 'BLOCKED: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — https://console.twilio.com/us1/account/keys-credentials/api-keys');
  test('PUT /api/voice/config with valid payload returns 200', async ({ authedPage: page }) => {
    const res = await page.request.put('/api/voice/config', {
      data: { site_id: 'e2e-voice-test', prompt: 'E2E test voice prompt' },
    });
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// VOICE-03 — Outbound SMS campaign send
// BLOCKED: needs TWILIO_* secrets
// ---------------------------------------------------------------------------
test.describe('VOICE-03 — Outbound SMS campaign send', () => {
  test('POST /api/voice/sms/send returns 401 without auth', async ({ page }) => {
    const res = await page.request.post('/api/voice/sms/send', {
      data: { to: '+12015550000', message: 'test', site_id: 'some-id' },
    });
    expect(res.status()).toBe(401);
  });

  test.skip(!TWILIO_PRESENT, 'BLOCKED: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — https://console.twilio.com/us1/account/keys-credentials/api-keys');
  test('POST /api/voice/sms/send with live Twilio returns 200', async ({ authedPage: page }) => {
    const res = await page.request.post('/api/voice/sms/send', {
      data: { to: process.env.TWILIO_TEST_TO ?? '+15005550006', message: 'E2E test', site_id: 'e2e-voice-test' },
    });
    expect(res.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// VOICE-04 — Voice-mode keyboard shortcut activates dictation
// ---------------------------------------------------------------------------
test.describe('VOICE-04 — Voice-mode keyboard shortcut', () => {
  test('Admin page does not crash when voice feature flag is off', async ({ authedPage: page }) => {
    await page.goto('/');
    // Pressing the voice shortcut when flag is off should do nothing catastrophic
    await page.keyboard.press('Control+Shift+V');
    // Page should still be responsive
    await expect(page.locator('body')).toBeVisible();
  });
});
