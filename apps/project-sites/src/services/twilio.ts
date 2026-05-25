/**
 * @module services/twilio
 * @description Thin Twilio REST client + vanity letter↔digit helpers.
 *
 * Workers-compatible: uses native `fetch` with Basic auth (`btoa('SID:TOKEN')`).
 * No `twilio` SDK — the SDK depends on Node `https`/`stream` which Workers
 * cannot polyfill cleanly.
 *
 * Every callable verifies `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` are
 * present and throws {@link AppError} with `TWILIO_NOT_CONFIGURED` (501) when
 * they are not — callers may catch and surface to the route layer.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { AppError } from '@project-sites/shared';

// ─── Letter → digit (E.161 keypad) ───────────────────────────────
const LETTER_DIGIT_MAP: Record<string, string> = {
  A: '2', B: '2', C: '2',
  D: '3', E: '3', F: '3',
  G: '4', H: '4', I: '4',
  J: '5', K: '5', L: '5',
  M: '6', N: '6', O: '6',
  P: '7', Q: '7', R: '7', S: '7',
  T: '8', U: '8', V: '8',
  W: '9', X: '9', Y: '9', Z: '9',
};

/**
 * Convert every letter (A-Z, case-insensitive) in `s` to its E.161 keypad
 * digit. Non-letters pass through untouched.
 *
 * @example
 * letterToDigit('ABOR')      // '2267'
 * letterToDigit('1-800-FLOWERS') // '1-800-3569377'
 * letterToDigit('82*ABOR')   // '82*2267' — preserves Twilio's `Contains=` wildcard
 */
export function letterToDigit(s: string): string {
  let out = '';
  for (const ch of s) {
    const upper = ch.toUpperCase();
    out += LETTER_DIGIT_MAP[upper] ?? ch;
  }
  return out;
}

/**
 * Render an E.164 number with the vanity word highlighted in-place.
 *
 * Returns the canonical formatted display (e.g. `"(855) 82L-ABOR"`) by
 * splitting the area code + first three + last four and substituting the
 * vanity letters back into the digits where they match.
 *
 * @param e164     - `+1` E.164 string, e.g. `+18558225267`.
 * @param word     - The vanity word the caller chose, e.g. `'ABOR'`.
 * @param position - `'end'` (default) places the word at the tail of the
 *                   line number; `'start'` after the area code.
 */
export function formatVanity(
  e164: string,
  word: string,
  position: 'start' | 'end' = 'end',
): string {
  // Strip "+1" then split into (NPA)NXX-XXXX
  const digits = e164.replace(/^\+1/, '').replace(/\D/g, '');
  if (digits.length !== 10) return e164; // unknown shape — bail
  const area = digits.slice(0, 3);
  const nxx = digits.slice(3, 6);
  const line = digits.slice(6, 10);
  const wordUpper = word.toUpperCase();

  if (position === 'end') {
    // word occupies the tail of nxx+line. e.g. word=ABOR (4) → tail = nxx[2]+line
    const wordLen = wordUpper.length;
    const tail = (nxx + line).slice(-wordLen);
    const head = (nxx + line).slice(0, 7 - wordLen);
    // Sanity: ensure the letter-converted word matches the displaced digits
    if (letterToDigit(wordUpper).replace(/\D/g, '') === tail) {
      // splice — head fills nxx, then letters complete nxx+line
      const nxxBlended = (head + wordUpper).slice(0, 3);
      const lineBlended = (head + wordUpper).slice(3);
      return `(${area}) ${nxxBlended}-${lineBlended}`;
    }
  } else {
    // word starts at nxx
    const wordLen = wordUpper.length;
    const head = wordUpper;
    const remaining = (nxx + line).slice(wordLen);
    if (letterToDigit(wordUpper) === (nxx + line).slice(0, wordLen)) {
      const nxxBlended = (head + remaining).slice(0, 3);
      const lineBlended = (head + remaining).slice(3);
      return `(${area}) ${nxxBlended}-${lineBlended}`;
    }
  }

  // Fallback: untransformed pretty format
  return `(${area}) ${nxx}-${line}`;
}

// ─── Auth helpers ────────────────────────────────────────────────

interface TwilioCreds {
  sid: string;
  token: string;
}

function getCreds(env: Env): TwilioCreds {
  const sid = (env.TWILIO_ACCOUNT_SID ?? '').trim();
  const token = (env.TWILIO_AUTH_TOKEN ?? '').trim();
  if (!sid || !token) {
    throw new AppError({
      code: 'NOT_FOUND', // No dedicated 501 code in ApiErrorCode; route handler maps this
      message:
        'TWILIO_NOT_CONFIGURED: set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN via `wrangler secret put`',
      statusCode: 501,
    });
  }
  return { sid, token };
}

function basicAuthHeader({ sid, token }: TwilioCreds): string {
  return `Basic ${btoa(`${sid}:${token}`)}`;
}

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

/** True when the worker can talk to Twilio at all. */
export function isTwilioConfigured(env: Env): boolean {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}

// ─── Number search ───────────────────────────────────────────────

export interface NumberSearchOpts {
  country?: string;            // ISO-3166 alpha-2, default 'US'
  areaCode?: number | string;
  contains?: string;           // Twilio `Contains` param — supports letters
  voiceEnabled?: boolean;
  smsEnabled?: boolean;
  limit?: number;              // 1-30
}

export interface AvailableNumber {
  phone_number: string;        // +1…
  friendly_name: string;
  locality: string | null;
  region: string | null;
  iso_country: string;
  capabilities: {
    voice: boolean;
    sms: boolean;
    mms: boolean;
    fax: boolean;
  };
}

interface TwilioAvailableRow {
  phone_number: string;
  friendly_name: string;
  locality: string | null;
  region: string | null;
  iso_country: string;
  capabilities: { voice?: boolean; SMS?: boolean; MMS?: boolean; fax?: boolean };
}

/**
 * Search Twilio's pool of available local numbers.
 *
 * Letter-bearing `contains` values (e.g. `"82*ABOR"`) are translated to
 * Twilio's digit-pattern syntax via {@link letterToDigit} before the call.
 */
export async function searchAvailableNumbers(
  env: Env,
  opts: NumberSearchOpts = {},
): Promise<AvailableNumber[]> {
  const creds = getCreds(env);
  const country = opts.country ?? 'US';

  const url = new URL(`${TWILIO_BASE}/Accounts/${creds.sid}/AvailablePhoneNumbers/${country}/Local.json`);
  if (opts.areaCode) url.searchParams.set('AreaCode', String(opts.areaCode));
  if (opts.contains) url.searchParams.set('Contains', letterToDigit(opts.contains));
  if (opts.voiceEnabled !== false) url.searchParams.set('VoiceEnabled', 'true');
  if (opts.smsEnabled !== false) url.searchParams.set('SmsEnabled', 'true');
  url.searchParams.set('PageSize', String(Math.min(Math.max(opts.limit ?? 20, 1), 30)));

  const res = await fetch(url.toString(), {
    headers: { Authorization: basicAuthHeader(creds), Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new AppError({
      code: 'BAD_REQUEST',
      message: `Twilio number search failed: ${res.status} ${await safeBody(res)}`,
      statusCode: 502,
    });
  }
  const json = (await res.json()) as { available_phone_numbers?: TwilioAvailableRow[] };
  return (json.available_phone_numbers ?? []).map((row) => ({
    phone_number: row.phone_number,
    friendly_name: row.friendly_name,
    locality: row.locality,
    region: row.region,
    iso_country: row.iso_country,
    capabilities: {
      voice: !!row.capabilities?.voice,
      sms: !!row.capabilities?.SMS,
      mms: !!row.capabilities?.MMS,
      fax: !!row.capabilities?.fax,
    },
  }));
}

// ─── Number purchase + release ───────────────────────────────────

export interface PurchaseOpts {
  phoneNumber: string;
  voiceUrl: string;
  smsUrl: string;
  friendlyName?: string;
}

export interface PurchasedNumber {
  sid: string;
  phone_number: string;
  friendly_name: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean };
}

export async function purchaseNumber(env: Env, opts: PurchaseOpts): Promise<PurchasedNumber> {
  const creds = getCreds(env);
  const body = new URLSearchParams();
  body.set('PhoneNumber', opts.phoneNumber);
  body.set('VoiceUrl', opts.voiceUrl);
  body.set('VoiceMethod', 'POST');
  body.set('SmsUrl', opts.smsUrl);
  body.set('SmsMethod', 'POST');
  if (opts.friendlyName) body.set('FriendlyName', opts.friendlyName);

  const res = await fetch(`${TWILIO_BASE}/Accounts/${creds.sid}/IncomingPhoneNumbers.json`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(creds),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new AppError({
      code: 'BAD_REQUEST',
      message: `Twilio purchase failed: ${res.status} ${await safeBody(res)}`,
      statusCode: 502,
    });
  }
  const json = (await res.json()) as {
    sid: string;
    phone_number: string;
    friendly_name: string;
    capabilities: { voice?: boolean; SMS?: boolean; MMS?: boolean; fax?: boolean };
  };
  return {
    sid: json.sid,
    phone_number: json.phone_number,
    friendly_name: json.friendly_name,
    capabilities: {
      voice: !!json.capabilities?.voice,
      sms: !!json.capabilities?.SMS,
      mms: !!json.capabilities?.MMS,
      fax: !!json.capabilities?.fax,
    },
  };
}

/** Release a previously-purchased number back to Twilio's pool. */
export async function releaseNumber(env: Env, twilioSid: string): Promise<void> {
  const creds = getCreds(env);
  const res = await fetch(
    `${TWILIO_BASE}/Accounts/${creds.sid}/IncomingPhoneNumbers/${twilioSid}.json`,
    { method: 'DELETE', headers: { Authorization: basicAuthHeader(creds) } },
  );
  if (!res.ok && res.status !== 404) {
    throw new AppError({
      code: 'BAD_REQUEST',
      message: `Twilio release failed: ${res.status} ${await safeBody(res)}`,
      statusCode: 502,
    });
  }
}

// ─── SMS ────────────────────────────────────────────────────────

export interface SendSmsOpts {
  from: string;     // E.164
  to: string;       // E.164
  body: string;
  mediaUrl?: string;
}

export interface SentSms {
  sid: string;
  status: string;
  num_segments: number;
  price: string | null;
}

export async function sendSms(env: Env, opts: SendSmsOpts): Promise<SentSms> {
  const creds = getCreds(env);
  const body = new URLSearchParams();
  body.set('From', opts.from);
  body.set('To', opts.to);
  body.set('Body', opts.body);
  if (opts.mediaUrl) body.set('MediaUrl', opts.mediaUrl);

  const res = await fetch(`${TWILIO_BASE}/Accounts/${creds.sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(creds),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new AppError({
      code: 'BAD_REQUEST',
      message: `Twilio sendSms failed: ${res.status} ${await safeBody(res)}`,
      statusCode: 502,
    });
  }
  const json = (await res.json()) as {
    sid: string;
    status: string;
    num_segments: string;
    price: string | null;
  };
  return {
    sid: json.sid,
    status: json.status,
    num_segments: parseInt(json.num_segments, 10) || 1,
    price: json.price,
  };
}

// ─── Recordings ─────────────────────────────────────────────────

export async function createCallRecording(env: Env, callSid: string): Promise<{ sid: string }> {
  const creds = getCreds(env);
  const body = new URLSearchParams();
  body.set('RecordingStatusCallbackEvent', 'completed');
  const res = await fetch(
    `${TWILIO_BASE}/Accounts/${creds.sid}/Calls/${callSid}/Recordings.json`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(creds),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    throw new AppError({
      code: 'BAD_REQUEST',
      message: `Twilio createCallRecording failed: ${res.status}`,
      statusCode: 502,
    });
  }
  const json = (await res.json()) as { sid: string };
  return { sid: json.sid };
}

export interface FetchedRecording {
  sid: string;
  duration: number;
  channels: number;
  /** Direct download URL — append `.mp3` or `.wav` to fetch the audio bytes. */
  download_url: string;
}

export async function fetchRecording(env: Env, recordingSid: string): Promise<FetchedRecording> {
  const creds = getCreds(env);
  const res = await fetch(
    `${TWILIO_BASE}/Accounts/${creds.sid}/Recordings/${recordingSid}.json`,
    { headers: { Authorization: basicAuthHeader(creds), Accept: 'application/json' } },
  );
  if (!res.ok) {
    throw new AppError({
      code: 'NOT_FOUND',
      message: `Twilio recording lookup failed: ${res.status}`,
      statusCode: res.status === 404 ? 404 : 502,
    });
  }
  const json = (await res.json()) as {
    sid: string;
    duration: string;
    channels: number;
    uri: string;
  };
  return {
    sid: json.sid,
    duration: parseInt(json.duration, 10) || 0,
    channels: json.channels || 1,
    // .uri ends in .json; swap for .mp3 download
    download_url: `${TWILIO_BASE}${json.uri.replace(/\.json$/, '.mp3')}`,
  };
}

/**
 * Download recording bytes (suitable for `r2.put(...)`). Requires the auth
 * header — Twilio recording downloads are NOT public.
 */
export async function downloadRecordingBytes(
  env: Env,
  downloadUrl: string,
): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const creds = getCreds(env);
  const res = await fetch(downloadUrl, { headers: { Authorization: basicAuthHeader(creds) } });
  if (!res.ok) {
    throw new AppError({
      code: 'NOT_FOUND',
      message: `Recording download failed: ${res.status}`,
      statusCode: 502,
    });
  }
  return {
    bytes: await res.arrayBuffer(),
    mime: res.headers.get('content-type') ?? 'audio/mpeg',
  };
}

// ─── Webhook signature verification (Twilio X-Twilio-Signature) ───

/**
 * Verify a Twilio webhook signature.
 *
 * Algorithm (per Twilio docs):
 *   1. Build the validation string: `url` + concat(sorted form-param key=value).
 *   2. HMAC-SHA1 with `TWILIO_AUTH_TOKEN` as the key.
 *   3. Base64-encode the digest and constant-time compare to the header.
 *
 * @param env       - Worker env (reads `TWILIO_AUTH_TOKEN`).
 * @param signature - Value of the `X-Twilio-Signature` header.
 * @param url       - The fully-qualified URL Twilio called (path + query).
 * @param params    - The parsed `application/x-www-form-urlencoded` body.
 */
export async function validateSignature(
  env: Env,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  const token = (env.TWILIO_AUTH_TOKEN ?? '').trim();
  if (!token || !signature) return false;

  // Sorted key concatenation per Twilio spec
  const sortedKeys = Object.keys(params).sort();
  let validationString = url;
  for (const k of sortedKeys) validationString += k + params[k];

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(token),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(validationString)),
  );
  // base64
  let bin = '';
  for (const b of sigBytes) bin += String.fromCharCode(b);
  const expected = btoa(bin);

  // Constant-time compare
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ─── Small util ──────────────────────────────────────────────────

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 256);
  } catch {
    return '(no body)';
  }
}
