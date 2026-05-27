/**
 * Twilio Verify (voice OTP + SMS) + call masking placeholder.
 */

import type { Env } from '../env.js';
import { AppError, ErrorCode } from '../types.js';

function basicAuth(env: Env): string {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Twilio not configured');
  }
  return 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
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
