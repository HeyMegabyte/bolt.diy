/**
 * @module routes/domain_stack
 *
 * @description
 * Domain Stack One-Click Wizard HTTP routes.
 *
 * Routes:
 *   POST /api/domains/:hostname/stack        Start or resume the wizard
 *   GET  /api/domains/:hostname/stack-status  Current state + per-step results
 *
 * Gated behind feature flag `domain_stack_wizard`. Returns 404 when off.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { unauthorized, notFound, badRequest } from '@project-sites/shared';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  createStackRun,
  advanceStackRun,
  getStackStatus,
} from '../services/domain_stack.js';
import { dbQueryOne } from '../services/db.js';
import * as auditService from '../services/audit.js';

const domainStack = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── POST /api/domains/:hostname/stack ──────────────────────────────────

const startSchema = z.object({
  site_id: z.string().min(1),
  run_id: z.string().uuid().optional(),
});

/**
 * Start or resume the stack wizard for a hostname.
 *
 * If `run_id` is provided, resumes from the current state (idempotent).
 * Otherwise, creates a new run and advances one step.
 */
domainStack.post(
  '/api/domains/:hostname/stack',
  zValidator('json', startSchema),
  async (c) => {
    const orgId = c.get('orgId');
    if (!orgId) throw unauthorized('Must be authenticated');

    const flagOn = await isFlagOn(c.env, 'domain_stack_wizard', { orgId });
    if (!flagOn) return c.json({ error: { code: 'feature_disabled', message: 'Domain stack wizard is not enabled.' } }, 404);

    const hostname = decodeURIComponent(c.req.param('hostname'));
    const body = c.req.valid('json');

    // Guard: hostname must belong to caller's org
    const hn = await dbQueryOne<{ id: string; org_id: string }>(
      c.env.DB,
      `SELECT h.id, s.org_id FROM hostnames h
         JOIN sites s ON s.id = h.site_id
       WHERE h.hostname = ? AND h.deleted_at IS NULL
         AND s.id = ? AND s.org_id = ?`,
      [hostname, body.site_id, orgId],
    );
    if (!hn) throw notFound('Hostname not found for this site / org');

    const runId = body.run_id ?? crypto.randomUUID();
    let run = await createStackRun(c.env, { runId, orgId, hostnameId: hn.id, hostname });

    // Advance one step per call (caller polls until state === 'done' | 'error')
    if (run.state !== 'done' && run.state !== 'error') {
      run = await advanceStackRun(c.env, runId);
    }

    auditService
      .writeAuditLog(c.env.DB, {
        org_id: orgId,
        actor_id: c.get('userId') ?? null,
        action: 'domain.stack.advanced',
        message: `Domain stack for '${hostname}' advanced to state '${run.state}'`,
        target_type: 'domain',
        target_id: hn.id,
        metadata_json: { hostname, state: run.state, run_id: runId },
        request_id: c.get('requestId'),
      })
      .catch(() => {});

    return c.json({ data: { run_id: runId, state: run.state, step_results: run.step_results, last_error: run.last_error } });
  },
);

// ─── GET /api/domains/:hostname/stack-status ────────────────────────────

domainStack.get('/api/domains/:hostname/stack-status', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const flagOn = await isFlagOn(c.env, 'domain_stack_wizard', { orgId });
  if (!flagOn) return c.json({ error: { code: 'feature_disabled', message: 'Domain stack wizard is not enabled.' } }, 404);

  const hostname = decodeURIComponent(c.req.param('hostname'));
  const run = await getStackStatus(c.env, hostname);
  if (!run) throw notFound('No stack run found for this hostname');

  // Verify org owns this hostname
  const owns = await dbQueryOne<{ id: string }>(
    c.env.DB,
    `SELECT h.id FROM hostnames h
       JOIN sites s ON s.id = h.site_id
     WHERE h.hostname = ? AND h.deleted_at IS NULL AND s.org_id = ?`,
    [hostname, orgId],
  );
  if (!owns) throw notFound('Hostname not found for this org');

  const STEP_ORDER = ['register', 'dns', 'ssl', 'email_auth', 'discovery', 'gsc', 'done'];
  const currentIdx = STEP_ORDER.indexOf(run.state);
  const tiles = STEP_ORDER.filter((s) => s !== 'done').map((step, i) => ({
    step,
    label: STEP_LABELS[step] ?? step,
    status: run.step_results[step]?.ok
      ? 'done'
      : run.state === step
        ? 'in_progress'
        : i < currentIdx
          ? 'done'
          : 'pending',
    error: run.step_results[step]?.error ?? null,
    data: run.step_results[step]?.data ?? null,
  }));

  return c.json({
    data: {
      run_id: run.id,
      hostname,
      state: run.state,
      tiles,
      done_at: run.done_at,
      last_error: run.last_error,
      retries: run.retries,
    },
  });
});

const STEP_LABELS: Record<string, string> = {
  register: 'Domain Registered',
  dns: 'DNS Records',
  ssl: 'SSL / TLS',
  email_auth: 'DMARC · SPF · DKIM · MX',
  discovery: 'Security.txt',
  gsc: 'Google Search Console',
};

export { domainStack };
