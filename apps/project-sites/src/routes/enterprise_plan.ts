/**
 * @module routes/enterprise_plan
 *
 * Enterprise Plan API routes — idea #44.
 *
 * Mount path: `/api/enterprise`
 *
 * Routes:
 *   GET    /api/enterprise/contract          Get the org's enterprise contract
 *   PUT    /api/enterprise/contract          Update contract fields
 *   GET    /api/enterprise/sla                Last 90 days of SLA snapshots + rolling avg
 *   POST   /api/enterprise/sla/snapshot       Append a daily SLA snapshot (internal)
 *   GET    /api/enterprise/audit-exports      List audit export jobs
 *   POST   /api/enterprise/audit-exports      Enqueue an audit export bundle
 *   GET    /api/enterprise/sso/config         Current SSO config
 *   PUT    /api/enterprise/sso/config         Update SSO config
 *
 * Every handler requires auth + the `enterprise_plan` flag. When off,
 * returns 404.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  EnterpriseContractUpdateSchema,
  SsoConfigSchema,
  SlaSnapshotSchema,
  AuditExportRequestSchema,
  rollingUptimePct,
  isSlaBreached,
} from '../../libs/features/enterprise_plan/feature.schemas.js';
import {
  getContract,
  upsertContract,
  getSsoConfig,
  updateSsoConfig,
  listSlaSnapshots,
  appendSlaSnapshot,
  listAuditExports,
  enqueueAuditExport,
} from '../services/enterprise_plan.js';

const FLAG_KEY = 'enterprise_plan';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const enterprisePlan = new Hono<{ Bindings: Env; Variables: Variables }>();

async function guard(c: AppContext): Promise<Response | null> {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId || !orgId) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Auth required' } },
      401,
    );
  }
  const on = await isFlagOn(c.env, FLAG_KEY, { orgId });
  if (!on) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Not found' } },
      404,
    );
  }
  return null;
}

// ─── Contract ────────────────────────────────────────────────────────────────

enterprisePlan.get('/api/enterprise/contract', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const data = await getContract(c.env, orgId);
  return c.json({ data });
});

enterprisePlan.put(
  '/api/enterprise/contract',
  zValidator('json', EnterpriseContractUpdateSchema),
  async (c) => {
    const blocked = await guard(c);
    if (blocked) return blocked;
    const orgId = c.get('orgId')!;
    const data = await upsertContract(c.env, orgId, c.req.valid('json'));
    return c.json({ data });
  },
);

// ─── SLA ─────────────────────────────────────────────────────────────────────

enterprisePlan.get('/api/enterprise/sla', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const contract = await getContract(c.env, orgId);
  const snapshots = await listSlaSnapshots(c.env, orgId, 90);
  const rolling = rollingUptimePct(snapshots);
  const breached = isSlaBreached(rolling, contract?.sla_pct ?? 99.9);
  return c.json({
    data: {
      contract_sla_pct: contract?.sla_pct ?? 99.9,
      rolling_uptime_pct: rolling,
      breached,
      snapshots,
    },
  });
});

enterprisePlan.post(
  '/api/enterprise/sla/snapshot',
  zValidator('json', SlaSnapshotSchema),
  async (c) => {
    const blocked = await guard(c);
    if (blocked) return blocked;
    const orgId = c.get('orgId')!;
    const data = await appendSlaSnapshot(c.env, orgId, c.req.valid('json'));
    return c.json({ data });
  },
);

// ─── Audit exports ───────────────────────────────────────────────────────────

enterprisePlan.get('/api/enterprise/audit-exports', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const data = await listAuditExports(c.env, orgId);
  return c.json({ data });
});

enterprisePlan.post(
  '/api/enterprise/audit-exports',
  zValidator('json', AuditExportRequestSchema),
  async (c) => {
    const blocked = await guard(c);
    if (blocked) return blocked;
    const orgId = c.get('orgId')!;
    const userId = c.get('userId') ?? null;
    const data = await enqueueAuditExport(
      c.env,
      orgId,
      c.req.valid('json'),
      userId,
    );
    return c.json({ data }, 202);
  },
);

// ─── SSO ─────────────────────────────────────────────────────────────────────

enterprisePlan.get('/api/enterprise/sso/config', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId')!;
  const data = await getSsoConfig(c.env, orgId);
  return c.json({ data });
});

enterprisePlan.put(
  '/api/enterprise/sso/config',
  zValidator('json', SsoConfigSchema),
  async (c) => {
    const blocked = await guard(c);
    if (blocked) return blocked;
    const orgId = c.get('orgId')!;
    const data = await updateSsoConfig(c.env, orgId, c.req.valid('json'));
    return c.json({ data });
  },
);

export { enterprisePlan };
