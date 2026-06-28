/**
 * @module services/auth_anomaly
 *
 * @description
 * Lightweight new-IP / new-device login-anomaly detection for Better Auth (#44).
 * The session-create hook has only the session row (IP + user-agent, no request
 * geo), so this module detects what IS derivable from that: a sign-in from an IP
 * or device the user has never used before. The prior signal lives in KV
 * (`auth:lastlogin:<userId>`), so detection is one KV read + one KV write — no D1
 * round-trip on the sign-in hot path.
 *
 * True geo impossible-travel (velocity between coordinates) needs request-time
 * `cf.country`/`cf.colo` and a per-login geo log; that is a follow-up that records
 * the signal at the route layer. This module is the IP/device tier that ships now.
 */
import type { Env } from '../types/env.js';

/** A single login signal captured at session creation. */
export interface LoginSignal {
  /** Client IP (Better Auth session `ipAddress`), or '' when unknown. */
  readonly ip: string;
  /** Client user-agent (Better Auth session `userAgent`), or '' when unknown. */
  readonly ua: string;
  /** Unix ms timestamp of the login. */
  readonly ts: number;
}

/** What the user's recent history holds. Bounded to the last {@link HISTORY_CAP} entries. */
interface LoginHistory {
  readonly ips: string[];
  readonly uas: string[];
  readonly last: LoginSignal | null;
}

/** The verdict for one login against the user's history. */
export interface AnomalyAssessment {
  /** True when the login IP was never seen in the retained history. */
  readonly newIp: boolean;
  /** True when the user-agent was never seen in the retained history. */
  readonly newDevice: boolean;
  /** Machine-readable reasons, e.g. `['new_ip','new_device']`. Empty = unremarkable. */
  readonly reasons: string[];
  /** True when any reason fired (convenience for callers). */
  readonly anomalous: boolean;
}

/** How many distinct IPs / UAs to retain per user before evicting the oldest. */
export const HISTORY_CAP = 10;

/** KV retention for a user's login history (180 days). */
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 180;

const kvKey = (userId: string): string => `auth:lastlogin:${userId}`;

/**
 * Compare a login against prior history. PURE — same inputs, same output.
 *
 * A login with no IP and no UA (both unknown) is never flagged: absence of
 * signal is not evidence of anomaly. A first-ever login (empty history) is NOT
 * flagged either — there is nothing to deviate from.
 *
 * @param history - The user's retained IP/UA history (empty for first login).
 * @param current - The login being assessed.
 * @returns The {@link AnomalyAssessment}.
 *
 * @example
 * assess({ ips: ['1.1.1.1'], uas: ['A'], last: null }, { ip: '2.2.2.2', ua: 'A', ts: 0 })
 * // → { newIp: true, newDevice: false, reasons: ['new_ip'], anomalous: true }
 */
export function assess(history: LoginHistory, current: LoginSignal): AnomalyAssessment {
  const firstEver = history.ips.length === 0 && history.uas.length === 0;
  const newIp = !firstEver && current.ip !== '' && !history.ips.includes(current.ip);
  const newDevice = !firstEver && current.ua !== '' && !history.uas.includes(current.ua);
  const reasons: string[] = [];
  if (newIp) reasons.push('new_ip');
  if (newDevice) reasons.push('new_device');
  return { newIp, newDevice, reasons, anomalous: reasons.length > 0 };
}

/** Fold a new signal into history, de-duped and capped (oldest evicted). */
function mergeHistory(history: LoginHistory, current: LoginSignal): LoginHistory {
  const push = (arr: string[], v: string): string[] =>
    v === '' || arr.includes(v) ? arr : [...arr, v].slice(-HISTORY_CAP);
  return {
    ips: push(history.ips, current.ip),
    uas: push(history.uas, current.ua),
    last: current,
  };
}

const EMPTY: LoginHistory = { ips: [], uas: [], last: null };

async function readHistory(env: Env, userId: string): Promise<LoginHistory> {
  try {
    const raw = await env.CACHE_KV.get(kvKey(userId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<LoginHistory>;
    return {
      ips: Array.isArray(parsed.ips) ? parsed.ips : [],
      uas: Array.isArray(parsed.uas) ? parsed.uas : [],
      last: parsed.last ?? null,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Record a login and return whether it deviates from the user's history.
 * Best-effort: any KV failure yields a non-anomalous verdict (never blocks sign-in).
 *
 * @remarks Impure — reads + writes KV.
 * @param env - Worker env (needs `CACHE_KV`).
 * @param userId - The authenticated user id.
 * @param current - The login signal from the new session.
 * @returns The {@link AnomalyAssessment} comparing against prior logins.
 *
 * @example
 * const verdict = await recordAndAssess(env, 'u_1', { ip, ua, ts: Date.now() });
 * if (verdict.anomalous) await alertSecurity(verdict.reasons);
 */
export async function recordAndAssess(
  env: Env,
  userId: string,
  current: LoginSignal,
): Promise<AnomalyAssessment> {
  try {
    const history = await readHistory(env, userId);
    const verdict = assess(history, current);
    const next = mergeHistory(history, current);
    await env.CACHE_KV.put(kvKey(userId), JSON.stringify(next), {
      expirationTtl: HISTORY_TTL_SECONDS,
    });
    return verdict;
  } catch {
    return { newIp: false, newDevice: false, reasons: [], anomalous: false };
  }
}
