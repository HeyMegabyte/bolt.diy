/**
 * Unit tests for the Enterprise Plan feature module (idea #44).
 *
 * Covers:
 *   - Zod schemas (contract update + SSO + SLA snapshot + audit export request)
 *   - rollingUptimePct + isSlaBreached pure helpers
 *   - upsertContract derives default ACV from tier when none given
 *   - upsertContract preserves existing fields on partial update
 *   - SSO config getter/setter round-trip
 *   - SLA snapshot append + list
 *   - enqueueAuditExport persists pending row
 */

import {
  EnterpriseContractUpdateSchema,
  SsoConfigSchema,
  SlaSnapshotSchema,
  AuditExportRequestSchema,
  TIER_FLOORS_USD_PER_MONTH,
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

// ─── In-memory D1 mock ───────────────────────────────────────────────────────

interface ContractRow {
  id: string;
  org_id: string;
  plan_tier: string;
  sla_pct: number;
  sso_enabled: number;
  sso_provider: string | null;
  sso_metadata_url: string | null;
  custom_terms_md: string | null;
  dedicated_slack_channel: string | null;
  annual_value_cents: number;
  contract_start: string | null;
  contract_end: string | null;
  audit_export_enabled: number;
  contract_signed_url: string | null;
  status: string;
  notes: string | null;
  updated_at: string;
  deleted_at: string | null;
}

interface SlaRow {
  org_id: string;
  measured_on: string;
  uptime_pct: number;
  incidents_count: number;
  p95_latency_ms: number | null;
  notes: string | null;
}

interface ExportRow {
  id: string;
  org_id: string;
  requested_by: string | null;
  range_start: string;
  range_end: string;
  r2_key: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
}

function makeEnv() {
  const contracts: ContractRow[] = [];
  const sla: SlaRow[] = [];
  const exports: ExportRow[] = [];

  function prepare(sql: string) {
    let binds: unknown[] = [];
    return {
      bind(...args: unknown[]) {
        binds = args;
        return this;
      },
      async first<T>(): Promise<T | null> {
        if (/FROM enterprise_contracts/.test(sql)) {
          const orgId = binds[0] as string;
          const row = contracts.find(
            (r) => r.org_id === orgId && r.deleted_at === null,
          );
          return (row as unknown as T) ?? null;
        }
        if (/SELECT.*FROM stripe_app_installations/.test(sql)) {
          return null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (/FROM enterprise_sla_metrics/.test(sql)) {
          const orgId = binds[0] as string;
          const filtered = sla.filter((r) => r.org_id === orgId);
          return { results: filtered as unknown as T[] };
        }
        if (/FROM enterprise_audit_exports/.test(sql)) {
          const orgId = binds[0] as string;
          const filtered = exports
            .filter((r) => r.org_id === orgId)
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
          return { results: filtered as unknown as T[] };
        }
        return { results: [] };
      },
      async run() {
        if (/^INSERT INTO enterprise_contracts/.test(sql.trim())) {
          const [
            id,
            org_id,
            plan_tier,
            sla_pct,
            sso_enabled,
            sso_provider,
            sso_metadata_url,
            custom_terms_md,
            dedicated_slack_channel,
            annual_value_cents,
            contract_start,
            contract_end,
            audit_export_enabled,
            contract_signed_url,
            status,
            notes,
          ] = binds as never[];
          const existing = contracts.find(
            (r) => r.org_id === org_id && r.deleted_at === null,
          );
          const now = new Date().toISOString();
          if (existing) {
            existing.plan_tier = plan_tier;
            existing.sla_pct = sla_pct;
            existing.sso_enabled = sso_enabled;
            existing.sso_provider = sso_provider;
            existing.sso_metadata_url = sso_metadata_url;
            existing.custom_terms_md = custom_terms_md;
            existing.dedicated_slack_channel = dedicated_slack_channel;
            existing.annual_value_cents = annual_value_cents;
            existing.contract_start = contract_start;
            existing.contract_end = contract_end;
            existing.audit_export_enabled = audit_export_enabled;
            existing.contract_signed_url = contract_signed_url;
            existing.status = status;
            existing.notes = notes;
            existing.updated_at = now;
          } else {
            contracts.push({
              id,
              org_id,
              plan_tier,
              sla_pct,
              sso_enabled,
              sso_provider,
              sso_metadata_url,
              custom_terms_md,
              dedicated_slack_channel,
              annual_value_cents,
              contract_start,
              contract_end,
              audit_export_enabled,
              contract_signed_url,
              status,
              notes,
              updated_at: now,
              deleted_at: null,
            });
          }
        }
        if (/^INSERT INTO enterprise_sla_metrics/.test(sql.trim())) {
          const [
            ,
            org_id,
            measured_on,
            uptime_pct,
            incidents_count,
            p95_latency_ms,
            notes,
          ] = binds as never[];
          const existing = sla.find(
            (r) => r.org_id === org_id && r.measured_on === measured_on,
          );
          if (existing) {
            existing.uptime_pct = uptime_pct;
            existing.incidents_count = incidents_count;
            existing.p95_latency_ms = p95_latency_ms;
            existing.notes = notes;
          } else {
            sla.push({
              org_id,
              measured_on,
              uptime_pct,
              incidents_count,
              p95_latency_ms,
              notes,
            });
          }
        }
        if (/^INSERT INTO enterprise_audit_exports/.test(sql.trim())) {
          const [id, org_id, requested_by, range_start, range_end] =
            binds as never[];
          exports.push({
            id,
            org_id,
            requested_by,
            range_start,
            range_end,
            r2_key: null,
            status: 'pending',
            expires_at: null,
            created_at: new Date().toISOString(),
          });
        }
        return { success: true, meta: {} };
      },
    };
  }

  return {
    env: {
      DB: { prepare } as unknown as D1Database,
    },
  };
}

// ─── Schemas + helpers ───────────────────────────────────────────────────────

describe('enterprise_plan schemas + helpers', () => {
  test('EnterpriseContractUpdateSchema accepts partial', () => {
    expect(() =>
      EnterpriseContractUpdateSchema.parse({ plan_tier: 'enterprise-large' }),
    ).not.toThrow();
  });

  test('SsoConfigSchema rejects bad provider', () => {
    expect(() =>
      SsoConfigSchema.parse({
        sso_enabled: true,
        sso_provider: 'magic' as never,
        sso_metadata_url: 'https://idp.example.com/metadata',
      }),
    ).toThrow();
  });

  test('SlaSnapshotSchema enforces YYYY-MM-DD shape', () => {
    expect(() =>
      SlaSnapshotSchema.parse({
        measured_on: 'yesterday',
        uptime_pct: 99.99,
      }),
    ).toThrow();
    expect(() =>
      SlaSnapshotSchema.parse({
        measured_on: '2026-05-28',
        uptime_pct: 99.99,
      }),
    ).not.toThrow();
  });

  test('AuditExportRequestSchema rejects inverted range', () => {
    expect(() =>
      AuditExportRequestSchema.parse({
        range_start: '2026-05-29',
        range_end: '2026-05-28',
      }),
    ).toThrow();
  });

  test('rollingUptimePct averages uptime_pct', () => {
    expect(rollingUptimePct([])).toBeNull();
    expect(
      rollingUptimePct([
        { measured_on: '2026-05-26', uptime_pct: 100, incidents_count: 0 },
        { measured_on: '2026-05-27', uptime_pct: 98, incidents_count: 1 },
        { measured_on: '2026-05-28', uptime_pct: 99, incidents_count: 0 },
      ]),
    ).toBeCloseTo(99);
  });

  test('isSlaBreached returns false when no rolling avg yet', () => {
    expect(isSlaBreached(null, 99.9)).toBe(false);
    expect(isSlaBreached(99.95, 99.9)).toBe(false);
    expect(isSlaBreached(99.5, 99.9)).toBe(true);
  });

  test('TIER_FLOORS_USD_PER_MONTH covers all tiers', () => {
    expect(TIER_FLOORS_USD_PER_MONTH['enterprise-small']).toBe(500);
    expect(TIER_FLOORS_USD_PER_MONTH['enterprise-mid']).toBe(1000);
    expect(TIER_FLOORS_USD_PER_MONTH['enterprise-large']).toBe(2000);
  });
});

// ─── Service-level ───────────────────────────────────────────────────────────

describe('enterprise_plan service', () => {
  test('upsertContract derives default ACV from tier when none given', async () => {
    const { env } = makeEnv();
    const contract = await upsertContract(env as never, 'org-1', {
      plan_tier: 'enterprise-mid',
    });
    expect(contract.plan_tier).toBe('enterprise-mid');
    expect(contract.annual_value_cents).toBe(1000 * 12 * 100);
    expect(contract.sla_pct).toBe(99.9);
    expect(contract.audit_export_enabled).toBe(true);
    expect(contract.status).toBe('pending');
  });

  test('upsertContract preserves existing fields on partial update', async () => {
    const { env } = makeEnv();
    await upsertContract(env as never, 'org-2', {
      plan_tier: 'enterprise-small',
      custom_terms_md: 'Initial terms',
    });
    const updated = await upsertContract(env as never, 'org-2', {
      sla_pct: 99.95,
    });
    expect(updated.plan_tier).toBe('enterprise-small');
    expect(updated.sla_pct).toBe(99.95);
    expect(updated.custom_terms_md).toBe('Initial terms');
  });

  test('getContract returns null when none exists', async () => {
    const { env } = makeEnv();
    expect(await getContract(env as never, 'nobody')).toBeNull();
  });

  test('SSO config round-trip', async () => {
    const { env } = makeEnv();
    await upsertContract(env as never, 'org-sso', {});
    const updated = await updateSsoConfig(env as never, 'org-sso', {
      sso_enabled: true,
      sso_provider: 'cloudflare-access',
      sso_metadata_url: 'https://team.example.cloudflareaccess.com/cdn-cgi/access/sso/oidc/.../callback',
    });
    expect(updated.sso_enabled).toBe(true);
    const reread = await getSsoConfig(env as never, 'org-sso');
    expect(reread.sso_provider).toBe('cloudflare-access');
  });

  test('SLA snapshot append + list', async () => {
    const { env } = makeEnv();
    await appendSlaSnapshot(env as never, 'org-sla', {
      measured_on: '2026-05-27',
      uptime_pct: 100,
      incidents_count: 0,
    });
    await appendSlaSnapshot(env as never, 'org-sla', {
      measured_on: '2026-05-28',
      uptime_pct: 99.8,
      incidents_count: 1,
    });
    const snapshots = await listSlaSnapshots(env as never, 'org-sla', 90);
    expect(snapshots).toHaveLength(2);
  });

  test('enqueueAuditExport persists pending row + list returns it', async () => {
    const { env } = makeEnv();
    const created = await enqueueAuditExport(
      env as never,
      'org-audit',
      { range_start: '2026-04-01', range_end: '2026-04-30' },
      'user-1',
    );
    expect(created.status).toBe('pending');
    expect(created.org_id).toBe('org-audit');
    const list = await listAuditExports(env as never, 'org-audit');
    expect(list).toHaveLength(1);
    expect(list[0]!.range_start).toBe('2026-04-01');
  });
});
