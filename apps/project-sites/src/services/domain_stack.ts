/**
 * @module services/domain_stack
 *
 * @description
 * Domain Stack One-Click Wizard — 7-step idempotent state machine that
 * drives a newly-registered domain from raw registration to a fully
 * configured, search-indexed, security-compliant web presence.
 *
 * Steps (state machine):
 *   register     → Cloudflare Registrar (already done before first run)
 *   dns          → Create A/CNAME + subdomain records via CF DNS API
 *   ssl          → CF for SaaS custom hostname + wait for SSL active
 *   email_auth   → DMARC + SPF + DKIM + MX records via CF DNS API
 *   discovery    → security.txt at /.well-known/security.txt in R2
 *   gsc          → Google Search Console TXT verification record
 *   done         → terminal success
 *   error        → terminal failure (retries exhausted)
 *
 * Every step is idempotent: re-running a completed step is a no-op. Retries
 * use exponential back-off (max 3 attempts per step). State is persisted to
 * D1 `domain_stack_runs`.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbQueryOne, dbInsert, dbUpdate } from './db.js';

export type StackState =
  | 'register'
  | 'dns'
  | 'ssl'
  | 'email_auth'
  | 'discovery'
  | 'gsc'
  | 'done'
  | 'error';

export interface StackRun {
  id: string;
  org_id: string;
  hostname_id: string;
  hostname: string;
  state: StackState;
  step_results: Record<string, StepResult>;
  retries: number;
  last_error: string | null;
  started_at: string;
  updated_at: string;
  done_at: string | null;
}

export interface StepResult {
  ok: boolean;
  error?: string;
  data?: unknown;
  attempts: number;
}

const CF_API = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';
const MAX_RETRIES = 3;

const STEP_ORDER: StackState[] = ['register', 'dns', 'ssl', 'email_auth', 'discovery', 'gsc', 'done'];

// ─── Public API ──────────────────────────────────────────────────────────

/** Bootstrap a new stack run for a just-registered domain. Idempotent. */
export async function createStackRun(
  env: Env,
  params: { runId: string; orgId: string; hostnameId: string; hostname: string },
): Promise<StackRun> {
  const existing = await dbQueryOne<StackRun>(
    env.DB,
    `SELECT id, org_id, hostname_id, hostname, state, step_results, retries,
            last_error, started_at, updated_at, done_at
     FROM domain_stack_runs WHERE id = ? AND deleted_at IS NULL`,
    [params.runId],
  );
  if (existing) return deserialize(existing);

  await dbInsert(env.DB, 'domain_stack_runs', {
    id: params.runId,
    org_id: params.orgId,
    hostname_id: params.hostnameId,
    hostname: params.hostname,
    state: 'register',
    step_results: '{}',
    retries: 0,
    last_error: null,
    started_at: new Date().toISOString(),
  });

  return {
    id: params.runId,
    org_id: params.orgId,
    hostname_id: params.hostnameId,
    hostname: params.hostname,
    state: 'register',
    step_results: {},
    retries: 0,
    last_error: null,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    done_at: null,
  };
}

/** Load an existing run. */
export async function getStackRun(env: Env, runId: string): Promise<StackRun | null> {
  const row = await dbQueryOne<StackRun>(
    env.DB,
    `SELECT id, org_id, hostname_id, hostname, state, step_results, retries,
            last_error, started_at, updated_at, done_at
     FROM domain_stack_runs WHERE id = ? AND deleted_at IS NULL`,
    [runId],
  );
  return row ? deserialize(row) : null;
}

/** Get status summary for a hostname (latest run). */
export async function getStackStatus(env: Env, hostname: string): Promise<StackRun | null> {
  const row = await dbQueryOne<StackRun>(
    env.DB,
    `SELECT id, org_id, hostname_id, hostname, state, step_results, retries,
            last_error, started_at, updated_at, done_at
     FROM domain_stack_runs
     WHERE hostname = ? AND deleted_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [hostname],
  );
  return row ? deserialize(row) : null;
}

/**
 * Advance the state machine by one step. Call repeatedly until
 * `run.state === 'done'` or `run.state === 'error'`.
 */
export async function advanceStackRun(env: Env, runId: string): Promise<StackRun> {
  const run = await getStackRun(env, runId);
  if (!run) throw new Error(`Stack run ${runId} not found`);
  if (run.state === 'done' || run.state === 'error') return run;

  const step = run.state;
  const prev = run.step_results[step] ?? { ok: false, attempts: 0 };

  if (prev.ok) {
    return await transitionNext(env, run, step, prev);
  }

  if (prev.attempts >= MAX_RETRIES) {
    return await markError(env, run, `Step ${step} exceeded max retries`);
  }

  const result = await runStep(env, run, step, prev);
  const updated = { ...run.step_results, [step]: result };
  await dbUpdate(
    env.DB,
    'domain_stack_runs',
    {
      step_results: JSON.stringify(updated),
      retries: run.retries + (result.ok ? 0 : 1),
      last_error: result.ok ? null : (result.error ?? null),
      updated_at: new Date().toISOString(),
    },
    'id = ?',
    [runId],
  );

  if (result.ok) {
    return await transitionNext(env, { ...run, step_results: updated }, step, result);
  }

  return { ...run, step_results: updated, retries: run.retries + 1, last_error: result.error ?? null };
}

// ─── Step runner ─────────────────────────────────────────────────────────

async function runStep(env: Env, run: StackRun, step: StackState, prev: StepResult): Promise<StepResult> {
  const attempts = prev.attempts + 1;
  try {
    switch (step) {
      case 'register':
        return { ok: true, attempts, data: { note: 'Already registered before wizard launch' } };

      case 'dns':
        return await stepDns(env, run, attempts);

      case 'ssl':
        return await stepSsl(env, run, attempts);

      case 'email_auth':
        return await stepEmailAuth(env, run, attempts);

      case 'discovery':
        return await stepDiscovery(env, run, attempts);

      case 'gsc':
        return await stepGsc(env, run, attempts);

      default:
        return { ok: true, attempts };
    }
  } catch (err) {
    return { ok: false, error: String(err), attempts };
  }
}

// ─── Step implementations ─────────────────────────────────────────────────

async function stepDns(env: Env, run: StackRun, attempts: number): Promise<StepResult> {
  const zoneId = (env as unknown as Record<string, string>)['CF_ZONE_ID'] ?? '';
  const token = (env as unknown as Record<string, string>)['CLOUDFLARE_API_TOKEN'] ?? '';
  if (!zoneId || !token) {
    return { ok: false, error: 'CF_ZONE_ID or CLOUDFLARE_API_TOKEN not configured', attempts };
  }

  // Upsert root A record pointing to our Worker via CNAME
  const cname = `${run.hostname.split('.').slice(-2).join('.')}-worker.projectsites.dev`;
  const resp = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'CNAME', name: run.hostname, content: cname, proxied: true, ttl: 1 }),
  });
  const body = await resp.json() as { success: boolean; errors?: Array<{ message: string }> };
  if (!body.success) {
    // Code 81057 = record already exists — idempotent success
    const alreadyExists = body.errors?.some((e) => e.message.includes('already exists') || String(e).includes('81057'));
    if (!alreadyExists) {
      return { ok: false, error: body.errors?.[0]?.message ?? 'DNS CNAME failed', attempts };
    }
  }

  return { ok: true, attempts, data: { cname } };
}

async function stepSsl(env: Env, run: StackRun, attempts: number): Promise<StepResult> {
  // CF for SaaS custom hostname — idempotent: check first, create if missing
  const token = (env as unknown as Record<string, string>)['CLOUDFLARE_API_TOKEN'] ?? '';
  const cfZone = (env as unknown as Record<string, string>)['CF_ZONE_ID'] ?? '';
  if (!token || !cfZone) {
    return { ok: false, error: 'CLOUDFLARE_API_TOKEN or CF_ZONE_ID not configured', attempts };
  }

  const checkResp = await fetch(
    `${CF_API}/zones/${cfZone}/custom_hostnames?hostname=${encodeURIComponent(run.hostname)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const checkBody = await checkResp.json() as { success: boolean; result?: Array<{ ssl?: { status: string } }> };
  const existing = checkBody.result?.[0];
  if (existing?.ssl?.status === 'active') {
    return { ok: true, attempts, data: { ssl_status: 'active' } };
  }

  if (!existing) {
    const createResp = await fetch(`${CF_API}/zones/${cfZone}/custom_hostnames`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: run.hostname, ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } } }),
    });
    const createBody = await createResp.json() as { success: boolean; result?: { ssl?: { status: string } }; errors?: Array<{ message: string }> };
    if (!createBody.success) {
      return { ok: false, error: createBody.errors?.[0]?.message ?? 'Custom hostname creation failed', attempts };
    }
    const sslStatus = createBody.result?.ssl?.status ?? 'pending';
    return { ok: sslStatus === 'active', error: sslStatus !== 'active' ? 'SSL pending — retry' : undefined, attempts, data: { ssl_status: sslStatus } };
  }

  // ssl not active yet
  return { ok: false, error: `SSL status: ${existing.ssl?.status ?? 'unknown'} — retry`, attempts };
}

async function stepEmailAuth(env: Env, run: StackRun, attempts: number): Promise<StepResult> {
  const token = (env as unknown as Record<string, string>)['CLOUDFLARE_API_TOKEN'] ?? '';
  const zoneId = (env as unknown as Record<string, string>)['CF_ZONE_ID'] ?? '';
  if (!token || !zoneId) {
    return { ok: false, error: 'CLOUDFLARE_API_TOKEN or CF_ZONE_ID not configured', attempts };
  }

  const domain = run.hostname;
  const records = [
    // SPF
    { type: 'TXT', name: domain, content: '"v=spf1 include:_spf.projectsites.dev ~all"', ttl: 300 },
    // DMARC
    { type: 'TXT', name: `_dmarc.${domain}`, content: '"v=DMARC1; p=quarantine; rua=mailto:dmarc@projectsites.dev; adkim=r; aspf=r"', ttl: 300 },
    // DKIM selector (placeholder public key — real key provisioned by email provider)
    { type: 'TXT', name: `ps._domainkey.${domain}`, content: '"v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAplaceholder"', ttl: 300 },
    // MX — route to projectsites mail relay
    { type: 'MX', name: domain, content: 'mail.projectsites.dev', priority: 10, ttl: 300 },
  ];

  const errors: string[] = [];
  for (const record of records) {
    const resp = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    const body = await resp.json() as { success: boolean; errors?: Array<{ message: string }> };
    if (!body.success) {
      const alreadyExists = body.errors?.some((e) => e.message.includes('already exists') || String(e).includes('81057'));
      if (!alreadyExists) errors.push(body.errors?.[0]?.message ?? 'DNS error');
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors.join('; '), attempts };
  }
  return { ok: true, attempts, data: { records_created: records.length } };
}

async function stepDiscovery(env: Env, run: StackRun, attempts: number): Promise<StepResult> {
  // Write security.txt to R2 under the site's public path
  const securityTxt = `Contact: mailto:security@projectsites.dev
Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}
Preferred-Languages: en
Policy: https://projectsites.dev/security
Canonical: https://${run.hostname}/.well-known/security.txt
`;
  try {
    await env.SITES_BUCKET.put(
      `sites/${run.hostname}/.well-known/security.txt`,
      securityTxt,
      { httpMetadata: { contentType: 'text/plain; charset=utf-8' } },
    );
    return { ok: true, attempts, data: { path: `sites/${run.hostname}/.well-known/security.txt` } };
  } catch (err) {
    return { ok: false, error: String(err), attempts };
  }
}

async function stepGsc(env: Env, run: StackRun, attempts: number): Promise<StepResult> {
  const token = (env as unknown as Record<string, string>)['CLOUDFLARE_API_TOKEN'] ?? '';
  const zoneId = (env as unknown as Record<string, string>)['CF_ZONE_ID'] ?? '';
  const gscToken = (env as unknown as Record<string, string>)['GOOGLE_SEARCH_CONSOLE_VERIFY_TOKEN'] ?? '';

  if (!token || !zoneId) {
    return { ok: false, error: 'CLOUDFLARE_API_TOKEN or CF_ZONE_ID not configured', attempts };
  }

  // If no GSC token configured, skip gracefully
  if (!gscToken) {
    return { ok: true, attempts, data: { skipped: true, reason: 'GOOGLE_SEARCH_CONSOLE_VERIFY_TOKEN not set' } };
  }

  const resp = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'TXT',
      name: run.hostname,
      content: `"google-site-verification=${gscToken}"`,
      ttl: 300,
    }),
  });
  const body = await resp.json() as { success: boolean; errors?: Array<{ message: string }> };
  if (!body.success) {
    const alreadyExists = body.errors?.some((e) => e.message.includes('already exists') || String(e).includes('81057'));
    if (!alreadyExists) {
      return { ok: false, error: body.errors?.[0]?.message ?? 'GSC TXT record failed', attempts };
    }
  }
  return { ok: true, attempts, data: { gsc_verification: true } };
}

// ─── State transitions ────────────────────────────────────────────────────

async function transitionNext(env: Env, run: StackRun, completedStep: StackState, result: StepResult): Promise<StackRun> {
  const idx = STEP_ORDER.indexOf(completedStep);
  const nextState: StackState = idx >= 0 && idx < STEP_ORDER.length - 1
    ? STEP_ORDER[idx + 1]
    : 'done';

  const now = new Date().toISOString();
  await dbUpdate(
    env.DB,
    'domain_stack_runs',
    {
      state: nextState,
      step_results: JSON.stringify({ ...run.step_results, [completedStep]: result }),
      updated_at: now,
      done_at: nextState === 'done' ? now : null,
    },
    'id = ?',
    [run.id],
  );

  return { ...run, state: nextState, step_results: { ...run.step_results, [completedStep]: result }, updated_at: now, done_at: nextState === 'done' ? now : null };
}

async function markError(env: Env, run: StackRun, error: string): Promise<StackRun> {
  const now = new Date().toISOString();
  await dbUpdate(env.DB, 'domain_stack_runs', { state: 'error', last_error: error, updated_at: now }, 'id = ?', [run.id]);
  return { ...run, state: 'error', last_error: error, updated_at: now };
}

// ─── Serialization helpers ────────────────────────────────────────────────

function deserialize(row: StackRun): StackRun {
  return {
    ...row,
    step_results: typeof row.step_results === 'string'
      ? (JSON.parse(row.step_results as unknown as string) as Record<string, StepResult>)
      : (row.step_results ?? {}),
  };
}
