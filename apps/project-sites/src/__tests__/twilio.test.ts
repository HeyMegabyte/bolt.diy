/**
 * Unit tests for the thin Twilio REST client + vanity helpers
 * ({@link services/twilio.ts}).
 *
 * Covers every branch:
 *   - pure helpers: letterToDigit (letters, wildcards, non-letters),
 *     formatVanity (end/start position, matching word, fallback,
 *     non-10-digit bail), isTwilioConfigured
 *   - getCreds (indirectly): TWILIO_NOT_CONFIGURED throw on missing/blank
 *     creds for every callable
 *   - searchAvailableNumbers: success parse + capability casing, query-param
 *     construction (AreaCode / Contains letter→digit / Voice+Sms defaults /
 *     PageSize clamp), Basic auth header, non-200 → SERVICE_UNAVAILABLE,
 *     empty/missing rows, network throw
 *   - purchaseNumber: success parse, request body shape, friendlyName branch,
 *     non-200 → SERVICE_UNAVAILABLE
 *   - releaseNumber: success, 404-tolerated, other non-200 throw
 *   - sendSms: success parse (num_segments parse fallback), mediaUrl branch,
 *     request body + Basic auth, non-200 throw
 *   - createCallRecording: success, non-200 throw
 *   - fetchRecording: success (.json→.mp3 download url, duration parse),
 *     404 → NOT_FOUND 404, other non-200 → 502
 *   - downloadRecordingBytes: success (bytes + mime fallback), non-200 throw
 *   - validateSignature: missing token, missing signature, valid signature
 *     round-trip, tampered signature, sorted-key concatenation, length mismatch
 *
 * Mocks the Twilio REST calls via `global.fetch` — never hits the real API.
 */

import type { Env } from '../types/env.js';
import {
  letterToDigit,
  formatVanity,
  isTwilioConfigured,
  searchAvailableNumbers,
  purchaseNumber,
  releaseNumber,
  sendSms,
  createCallRecording,
  fetchRecording,
  downloadRecordingBytes,
  validateSignature,
} from '../services/twilio.js';

const SID = 'AC0000000000000000000000000000aaaa';
const TOKEN = 'auth-token-secret';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const env = (overrides: Partial<Env> = {}): Env =>
  ({
    TWILIO_ACCOUNT_SID: SID,
    TWILIO_AUTH_TOKEN: TOKEN,
    ...overrides,
  }) as unknown as Env;

const noCredsEnv = (): Env => ({}) as unknown as Env;

function mockFetchOnce(
  body: unknown,
  init: { ok?: boolean; status?: number; arrayBuffer?: ArrayBuffer; contentType?: string | null } = {},
) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => init.arrayBuffer ?? new ArrayBuffer(8),
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'content-type'
          ? (init.contentType === undefined ? 'audio/mpeg' : init.contentType)
          : null,
    },
  });
}

const expectedBasicAuth = `Basic ${btoa(`${SID}:${TOKEN}`)}`;

// ─── letterToDigit ───────────────────────────────────────────

describe('letterToDigit', () => {
  it('maps every letter to its E.161 keypad digit', () => {
    expect(letterToDigit('ABOR')).toBe('2267');
    expect(letterToDigit('FLOWERS')).toBe('3569377');
  });

  it('is case-insensitive', () => {
    expect(letterToDigit('abor')).toBe('2267');
  });

  it('passes non-letters through untouched (digits, dashes, wildcards)', () => {
    expect(letterToDigit('1-800-FLOWERS')).toBe('1-800-3569377');
    expect(letterToDigit('82*ABOR')).toBe('82*2267');
  });

  it('returns empty string for empty input', () => {
    expect(letterToDigit('')).toBe('');
  });
});

// ─── formatVanity ────────────────────────────────────────────

describe('formatVanity', () => {
  it('bails (returns the e164) for a non-10-digit number', () => {
    expect(formatVanity('+44123', 'ABOR')).toBe('+44123');
  });

  it('blends a matching word at the end (default position)', () => {
    // +1 (855) 822-5267 → tail digits 25267 mapped from ABOR? word ABOR=2267
    // tail of nxx+line for wordLen=4 → '5267'; ABOR→2267 ≠ 5267 → fallback pretty
    expect(formatVanity('+18558225267', 'ABOR')).toBe('(855) 822-5267');
  });

  it('highlights word at end when letter-digits equal the displaced tail', () => {
    // number +1 (855) 5BO-R267? Build: nxx+line digits = '5252267' would need word=R267...
    // Use a clean case: word = 'BOR' (267), make tail '267'
    const e164 = '+18555550267';
    // nxx+line = 5550267, last 3 = '267' which BOR maps to → match
    expect(formatVanity(e164, 'BOR', 'end')).toBe('(855) 555-0BOR');
  });

  it('blends a matching word at the start position', () => {
    // word ABOR=2267 at start of nxx+line. nxx+line must start with 2267
    const e164 = '+18552267890';
    // nxx+line = 2267890, first 4 = 2267 = ABOR → match
    expect(formatVanity(e164, 'ABOR', 'start')).toBe('(855) ABO-R890');
  });

  it('falls back to pretty format when start word does not match', () => {
    expect(formatVanity('+18551234567', 'ABOR', 'start')).toBe('(855) 123-4567');
  });
});

// ─── isTwilioConfigured ──────────────────────────────────────

describe('isTwilioConfigured', () => {
  it('is true when both creds are present', () => {
    expect(isTwilioConfigured(env())).toBe(true);
  });

  it('is false when either cred is absent', () => {
    expect(isTwilioConfigured(noCredsEnv())).toBe(false);
    expect(isTwilioConfigured(env({ TWILIO_AUTH_TOKEN: '' } as Partial<Env>))).toBe(false);
  });
});

// ─── getCreds (via callables) ────────────────────────────────

describe('TWILIO_NOT_CONFIGURED guard', () => {
  it('throws SERVICE_UNAVAILABLE/501 for every callable when creds missing', async () => {
    const matcher = { code: 'SERVICE_UNAVAILABLE', statusCode: 501 };
    await expect(searchAvailableNumbers(noCredsEnv())).rejects.toMatchObject(matcher);
    await expect(
      purchaseNumber(noCredsEnv(), { phoneNumber: '+1', voiceUrl: 'v', smsUrl: 's' }),
    ).rejects.toMatchObject(matcher);
    await expect(releaseNumber(noCredsEnv(), 'PN1')).rejects.toMatchObject(matcher);
    await expect(
      sendSms(noCredsEnv(), { from: '+1', to: '+2', body: 'hi' }),
    ).rejects.toMatchObject(matcher);
    await expect(createCallRecording(noCredsEnv(), 'CA1')).rejects.toMatchObject(matcher);
    await expect(fetchRecording(noCredsEnv(), 'RE1')).rejects.toMatchObject(matcher);
    await expect(downloadRecordingBytes(noCredsEnv(), 'http://x')).rejects.toMatchObject(matcher);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('treats whitespace-only creds as missing', async () => {
    await expect(
      searchAvailableNumbers(env({ TWILIO_ACCOUNT_SID: '   ' } as Partial<Env>)),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

// ─── searchAvailableNumbers ──────────────────────────────────

describe('searchAvailableNumbers', () => {
  it('parses rows + casts capability casing (SMS/MMS → sms/mms)', async () => {
    mockFetchOnce({
      available_phone_numbers: [
        {
          phone_number: '+18005550100',
          friendly_name: '(800) 555-0100',
          locality: 'Newark',
          region: 'NJ',
          iso_country: 'US',
          capabilities: { voice: true, SMS: true, MMS: false, fax: true },
        },
      ],
    });
    const res = await searchAvailableNumbers(env());
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      phone_number: '+18005550100',
      locality: 'Newark',
      region: 'NJ',
      capabilities: { voice: true, sms: true, mms: false, fax: true },
    });
  });

  it('returns [] when the response omits available_phone_numbers', async () => {
    mockFetchOnce({});
    expect(await searchAvailableNumbers(env())).toEqual([]);
  });

  it('builds the query string: AreaCode, letter→digit Contains, clamped PageSize, Basic auth', async () => {
    mockFetchOnce({ available_phone_numbers: [] });
    await searchAvailableNumbers(env(), {
      country: 'CA',
      areaCode: 416,
      contains: '82*ABOR',
      limit: 99, // clamps to 30
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/AvailablePhoneNumbers/CA/Local.json');
    expect(url).toContain('AreaCode=416');
    expect(url).toContain('Contains=82*2267'); // letter→digit applied (URLSearchParams keeps *)
    expect(url).toContain('VoiceEnabled=true');
    expect(url).toContain('SmsEnabled=true');
    expect(url).toContain('PageSize=30');
    expect(init.headers.Authorization).toBe(expectedBasicAuth);
  });

  it('omits Voice/Sms flags only when explicitly set false; clamps low limit to 1', async () => {
    mockFetchOnce({ available_phone_numbers: [] });
    await searchAvailableNumbers(env(), {
      voiceEnabled: false,
      smsEnabled: false,
      limit: 0, // clamps up to 1
    });
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).not.toContain('VoiceEnabled');
    expect(url).not.toContain('SmsEnabled');
    expect(url).toContain('PageSize=1');
  });

  it('throws SERVICE_UNAVAILABLE/502 on non-200', async () => {
    mockFetchOnce('boom', { ok: false, status: 503 });
    await expect(searchAvailableNumbers(env())).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 502,
    });
  });

  it('propagates a network throw', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(searchAvailableNumbers(env())).rejects.toThrow('ECONNRESET');
  });
});

// ─── purchaseNumber ──────────────────────────────────────────

describe('purchaseNumber', () => {
  it('posts the number + urls and parses the purchased record', async () => {
    mockFetchOnce({
      sid: 'PN123',
      phone_number: '+18005550100',
      friendly_name: 'My Line',
      capabilities: { voice: true, SMS: true, MMS: true, fax: false },
    });
    const res = await purchaseNumber(env(), {
      phoneNumber: '+18005550100',
      voiceUrl: 'https://x/voice',
      smsUrl: 'https://x/sms',
      friendlyName: 'My Line',
    });
    expect(res).toMatchObject({
      sid: 'PN123',
      capabilities: { voice: true, sms: true, mms: true, fax: false },
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/IncomingPhoneNumbers.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(expectedBasicAuth);
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('PhoneNumber')).toBe('+18005550100');
    expect(body.get('VoiceUrl')).toBe('https://x/voice');
    expect(body.get('SmsUrl')).toBe('https://x/sms');
    expect(body.get('FriendlyName')).toBe('My Line');
  });

  it('omits FriendlyName when not provided', async () => {
    mockFetchOnce({ sid: 'PN1', phone_number: '+1', friendly_name: '', capabilities: {} });
    await purchaseNumber(env(), { phoneNumber: '+1', voiceUrl: 'v', smsUrl: 's' });
    const body = new URLSearchParams((global.fetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.has('FriendlyName')).toBe(false);
  });

  it('throws SERVICE_UNAVAILABLE/502 on non-200', async () => {
    mockFetchOnce('nope', { ok: false, status: 400 });
    await expect(
      purchaseNumber(env(), { phoneNumber: '+1', voiceUrl: 'v', smsUrl: 's' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 502 });
  });
});

// ─── releaseNumber ───────────────────────────────────────────

describe('releaseNumber', () => {
  it('DELETEs the number resource', async () => {
    mockFetchOnce({}, { ok: true, status: 204 });
    await expect(releaseNumber(env(), 'PN9')).resolves.toBeUndefined();
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/IncomingPhoneNumbers/PN9.json');
    expect(init.method).toBe('DELETE');
    expect(init.headers.Authorization).toBe(expectedBasicAuth);
  });

  it('tolerates a 404 (already released)', async () => {
    mockFetchOnce('', { ok: false, status: 404 });
    await expect(releaseNumber(env(), 'PNgone')).resolves.toBeUndefined();
  });

  it('throws on other non-200', async () => {
    mockFetchOnce('err', { ok: false, status: 500 });
    await expect(releaseNumber(env(), 'PN1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 502,
    });
  });
});

// ─── sendSms ─────────────────────────────────────────────────

describe('sendSms', () => {
  it('parses the sent message (num_segments numeric)', async () => {
    mockFetchOnce({ sid: 'SM1', status: 'queued', num_segments: '2', price: '-0.0075' });
    const res = await sendSms(env(), { from: '+1', to: '+2', body: 'hi' });
    expect(res).toEqual({ sid: 'SM1', status: 'queued', num_segments: 2, price: '-0.0075' });
  });

  it('defaults num_segments to 1 when unparseable', async () => {
    mockFetchOnce({ sid: 'SM2', status: 'sent', num_segments: 'NaN', price: null });
    const res = await sendSms(env(), { from: '+1', to: '+2', body: 'hi' });
    expect(res.num_segments).toBe(1);
    expect(res.price).toBeNull();
  });

  it('includes MediaUrl + Basic auth in the request when mediaUrl set', async () => {
    mockFetchOnce({ sid: 'SM3', status: 'queued', num_segments: '1', price: null });
    await sendSms(env(), { from: '+1', to: '+2', body: 'pic', mediaUrl: 'https://x/img.png' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/Messages.json');
    expect(init.headers.Authorization).toBe(expectedBasicAuth);
    const body = new URLSearchParams(init.body as string);
    expect(body.get('From')).toBe('+1');
    expect(body.get('To')).toBe('+2');
    expect(body.get('Body')).toBe('pic');
    expect(body.get('MediaUrl')).toBe('https://x/img.png');
  });

  it('omits MediaUrl when not provided', async () => {
    mockFetchOnce({ sid: 'SM4', status: 'queued', num_segments: '1', price: null });
    await sendSms(env(), { from: '+1', to: '+2', body: 'plain' });
    const body = new URLSearchParams((global.fetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.has('MediaUrl')).toBe(false);
  });

  it('throws SERVICE_UNAVAILABLE/502 on non-200', async () => {
    mockFetchOnce('fail', { ok: false, status: 422 });
    await expect(sendSms(env(), { from: '+1', to: '+2', body: 'x' })).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 502,
    });
  });
});

// ─── createCallRecording ─────────────────────────────────────

describe('createCallRecording', () => {
  it('posts to the call recordings endpoint and returns the sid', async () => {
    mockFetchOnce({ sid: 'RE1' });
    const res = await createCallRecording(env(), 'CA9');
    expect(res).toEqual({ sid: 'RE1' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/Calls/CA9/Recordings.json');
    expect(init.method).toBe('POST');
    expect(new URLSearchParams(init.body as string).get('RecordingStatusCallbackEvent')).toBe(
      'completed',
    );
  });

  it('throws SERVICE_UNAVAILABLE/502 on non-200', async () => {
    mockFetchOnce({}, { ok: false, status: 500 });
    await expect(createCallRecording(env(), 'CA9')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 502,
    });
  });
});

// ─── fetchRecording ──────────────────────────────────────────

describe('fetchRecording', () => {
  it('parses the recording + builds the .mp3 download url from the .json uri', async () => {
    mockFetchOnce({
      sid: 'RE5',
      duration: '42',
      channels: 2,
      uri: '/2010-04-01/Accounts/AC1/Recordings/RE5.json',
    });
    const res = await fetchRecording(env(), 'RE5');
    expect(res).toMatchObject({ sid: 'RE5', duration: 42, channels: 2 });
    expect(res.download_url).toBe(
      'https://api.twilio.com/2010-04-01/2010-04-01/Accounts/AC1/Recordings/RE5.mp3',
    );
  });

  it('defaults duration to 0 and channels to 1 when unparseable/absent', async () => {
    mockFetchOnce({ sid: 'RE6', duration: 'NaN', channels: 0, uri: '/x.json' });
    const res = await fetchRecording(env(), 'RE6');
    expect(res.duration).toBe(0);
    expect(res.channels).toBe(1);
  });

  it('throws NOT_FOUND/404 on a 404 lookup', async () => {
    mockFetchOnce('', { ok: false, status: 404 });
    await expect(fetchRecording(env(), 'REgone')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });

  it('throws NOT_FOUND/502 on other non-200', async () => {
    mockFetchOnce('', { ok: false, status: 500 });
    await expect(fetchRecording(env(), 'RE1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 502,
    });
  });
});

// ─── downloadRecordingBytes ──────────────────────────────────

describe('downloadRecordingBytes', () => {
  it('returns the bytes + content-type mime, with Basic auth header', async () => {
    const buf = new ArrayBuffer(16);
    mockFetchOnce(null, { ok: true, status: 200, arrayBuffer: buf, contentType: 'audio/wav' });
    const res = await downloadRecordingBytes(env(), 'https://api.twilio.com/x.mp3');
    expect(res.bytes).toBe(buf);
    expect(res.mime).toBe('audio/wav');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe(expectedBasicAuth);
  });

  it('defaults mime to audio/mpeg when no content-type header', async () => {
    mockFetchOnce(null, { ok: true, status: 200, contentType: null });
    const res = await downloadRecordingBytes(env(), 'https://api.twilio.com/x.mp3');
    expect(res.mime).toBe('audio/mpeg');
  });

  it('throws NOT_FOUND/502 on non-200', async () => {
    mockFetchOnce('', { ok: false, status: 403 });
    await expect(
      downloadRecordingBytes(env(), 'https://api.twilio.com/x.mp3'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 502 });
  });
});

// ─── validateSignature ───────────────────────────────────────

describe('validateSignature', () => {
  const url = 'https://projectsites.dev/voice/webhook';
  const params = { CallSid: 'CA1', From: '+15551234567', To: '+15557654321' };

  it('returns false when the auth token is missing', async () => {
    expect(await validateSignature(noCredsEnv(), 'anything', url, params)).toBe(false);
  });

  it('returns false when the signature is empty', async () => {
    expect(await validateSignature(env(), '', url, params)).toBe(false);
  });

  it('verifies a valid signature round-trip (HMAC-SHA1 + sorted-key concat)', async () => {
    // Compute the expected signature the same way the impl does, then feed it back.
    const sortedKeys = Object.keys(params).sort();
    let validationString = url;
    for (const k of sortedKeys) validationString += k + (params as Record<string, string>)[k];
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(TOKEN),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const sigBytes = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(validationString)),
    );
    let bin = '';
    for (const b of sigBytes) bin += String.fromCharCode(b);
    const expected = btoa(bin);

    expect(await validateSignature(env(), expected, url, params)).toBe(true);
  });

  it('rejects a tampered signature of the same length', async () => {
    const sortedKeys = Object.keys(params).sort();
    let validationString = url;
    for (const k of sortedKeys) validationString += k + (params as Record<string, string>)[k];
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(TOKEN),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const sigBytes = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(validationString)),
    );
    let bin = '';
    for (const b of sigBytes) bin += String.fromCharCode(b);
    const expected = btoa(bin);
    // Flip the first char to a different valid base64 char, same length.
    const tampered = (expected[0] === 'A' ? 'B' : 'A') + expected.slice(1);

    expect(await validateSignature(env(), tampered, url, params)).toBe(false);
  });

  it('returns false on a length mismatch (short signature)', async () => {
    expect(await validateSignature(env(), 'short', url, params)).toBe(false);
  });

  it('is sensitive to the URL (different URL → invalid)', async () => {
    // Build a valid sig for `url`, then verify against a different URL.
    const sortedKeys = Object.keys(params).sort();
    let validationString = url;
    for (const k of sortedKeys) validationString += k + (params as Record<string, string>)[k];
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(TOKEN),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const sigBytes = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(validationString)),
    );
    let bin = '';
    for (const b of sigBytes) bin += String.fromCharCode(b);
    const expected = btoa(bin);

    expect(
      await validateSignature(env(), expected, 'https://evil.example/voice/webhook', params),
    ).toBe(false);
  });
});
