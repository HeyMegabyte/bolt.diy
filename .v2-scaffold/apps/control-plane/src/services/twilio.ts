/**
 * Twilio Verify (voice OTP + SMS) + Twilio Proxy voice-masking sessions.
 */

import type { Env } from '../env.js';
import { AppError, ErrorCode } from '../types.js';

function basicAuth(env: Env): string {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Twilio not configured');
  }
  return 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
}

/** Twilio Proxy session response (subset we care about). */
export interface ProxySessionResult {
  readonly session_sid: string;
  readonly status: string;
  readonly expiration_ms: number;
  readonly masked_numbers: readonly { participant: string; proxy_identifier: string | null }[];
}

/**
 * Create a Twilio Proxy session that masks both participant phone numbers
 * behind the same Twilio proxy number. Used for end-customer ↔ crew voice
 * masking on the job-detail "Call (masked)" button (backlog item #25).
 *
 * Requires `TWILIO_PROXY_SERVICE_SID` to be configured on the Twilio side
 * — set via `wrangler secret put TWILIO_PROXY_SERVICE_SID`.
 *
 * @example
 * ```ts
 * const session = await createProxySession(env, {
 *   participants: ['+14155551234', '+14155556789'],
 *   expiresAtMs: Date.now() + 1000 * 60 * 60 * 2,
 * });
 * ```
 */
export async function createProxySession(
  env: Env,
  args: {
    proxyServiceSid?: string;
    participants: readonly string[];
    expiresAtMs: number;
    uniqueName?: string;
  },
): Promise<ProxySessionResult> {
  const serviceSid =
    args.proxyServiceSid ??
    (env as unknown as { TWILIO_PROXY_SERVICE_SID?: string }).TWILIO_PROXY_SERVICE_SID;
  if (!serviceSid) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      'TWILIO_PROXY_SERVICE_SID not configured',
    );
  }
  if (args.participants.length !== 2) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'Proxy session requires exactly 2 participants');
  }

  const sessionBody = new URLSearchParams({
    UniqueName: args.uniqueName ?? crypto.randomUUID(),
    Status: 'open',
    Mode: 'voice-only',
    DateExpiry: new Date(args.expiresAtMs).toISOString(),
  });
  const sessionRes = await fetch(
    `https://proxy.twilio.com/v1/Services/${serviceSid}/Sessions`,
    {
      method: 'POST',
      headers: {
        authorization: basicAuth(env),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: sessionBody,
    },
  );
  if (!sessionRes.ok) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Twilio Proxy session create failed: ${await sessionRes.text()}`,
    );
  }
  const sessionJson = (await sessionRes.json()) as {
    sid: string;
    status: string;
    date_expiry: string;
  };

  const maskedNumbers: { participant: string; proxy_identifier: string | null }[] = [];
  for (const phone of args.participants) {
    const partBody = new URLSearchParams({ Identifier: phone });
    const partRes = await fetch(
      `https://proxy.twilio.com/v1/Services/${serviceSid}/Sessions/${sessionJson.sid}/Participants`,
      {
        method: 'POST',
        headers: {
          authorization: basicAuth(env),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: partBody,
      },
    );
    if (!partRes.ok) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        `Twilio Proxy participant add failed: ${await partRes.text()}`,
      );
    }
    const partJson = (await partRes.json()) as { proxy_identifier?: string };
    maskedNumbers.push({
      participant: phone,
      proxy_identifier: partJson.proxy_identifier ?? null,
    });
  }

  return {
    session_sid: sessionJson.sid,
    status: sessionJson.status,
    expiration_ms: new Date(sessionJson.date_expiry).getTime(),
    masked_numbers: maskedNumbers,
  };
}

export async function startVoiceOtp(env: Env, phone: string): Promise<void> {
  if (!env.TWILIO_VERIFY_SERVICE_SID) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'TWILIO_VERIFY_SERVICE_SID missing');
  }
  const body = new URLSearchParams({ To: phone, Channel: 'call' });
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`,
    {
      method: 'POST',
      headers: {
        authorization: basicAuth(env),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  if (!res.ok) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, `Twilio start failed: ${await res.text()}`);
  }
}

export async function checkVoiceOtp(
  env: Env,
  phone: string,
  code: string,
): Promise<boolean> {
  if (!env.TWILIO_VERIFY_SERVICE_SID) return false;
  const body = new URLSearchParams({ To: phone, Code: code });
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
    {
      method: 'POST',
      headers: {
        authorization: basicAuth(env),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { status?: string };
  return data.status === 'approved';
}
