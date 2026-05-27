/**
 * Daily 80%-of-quota usage email alert — backlog item #36.
 *
 * Enumerates active tenants whose current period usage exceeds 80% of their
 * included tier quota. Sends a Resend email + records the alert in
 * `meter_alerts` so we don't double-fire per period.
 */

import type { Env } from '../env.js';
import { dbQuery, dbQueryOne } from './db.js';

const OVERAGE_RATE_CENTS_PER_REQ = 0.1; // $0.001/req
const ALERT_THRESHOLD_PCT = 80;

interface UsageRow {
  tenant_id: string;
  period_start: string;
  period_end: string;
  included: number;
  used: number;
}

interface TenantContactRow {
  tenant_id: string;
  email: string | null;
  name: string | null;
}

export interface MeterAlertReport {
  readonly tenants_checked: number;
  readonly alerts_sent: number;
  readonly skipped_already_sent: number;
  readonly failures: number;
}

/**
 * Run one pass of the meter-alert check. Idempotent within a period — the
 * `meter_alerts` UNIQUE constraint prevents duplicates.
 */
export async function runMeterAlerts(env: Env): Promise<MeterAlertReport> {
  const report = {
    tenants_checked: 0,
    alerts_sent: 0,
    skipped_already_sent: 0,
    failures: 0,
  };

  const rows = await dbQuery<UsageRow>(
    env.DB,
    `SELECT tenant_id, period_start, period_end, included, used
       FROM tenant_usage_periods
      WHERE period_end > ?1 AND included > 0`,
    [new Date().toISOString()],
  );

  for (const row of rows) {
    report.tenants_checked += 1;
    const pct = (row.used / row.included) * 100;
    if (pct < ALERT_THRESHOLD_PCT) continue;

    const already = await dbQueryOne<{ id: string }>(
      env.DB,
      `SELECT id FROM meter_alerts
        WHERE tenant_id = ?1 AND period_start = ?2 AND threshold_pct = ?3`,
      [row.tenant_id, row.period_start, ALERT_THRESHOLD_PCT],
    );
    if (already) {
      report.skipped_already_sent += 1;
      continue;
    }

    const overage = Math.max(0, row.used - row.included);
    const projectedOverageCents = Math.round(overage * OVERAGE_RATE_CENTS_PER_REQ);

    const contact = await dbQueryOne<TenantContactRow>(
      env.DB,
      `SELECT t.id AS tenant_id, u.email AS email, t.name AS name
         FROM tenants t
         LEFT JOIN team_members tm ON tm.tenant_id = t.id AND tm.role = 'owner'
         LEFT JOIN users u ON u.id = tm.user_id
        WHERE t.id = ?1 LIMIT 1`,
      [row.tenant_id],
    );

    if (!contact?.email) {
      report.failures += 1;
      continue;
    }

    const sent = await sendQuotaEmail(env, {
      to: contact.email,
      tenantName: contact.name ?? 'your workspace',
      used: row.used,
      included: row.included,
      pct: Math.round(pct),
      projectedOverageCents,
      periodEnd: row.period_end,
    });

    if (!sent) {
      report.failures += 1;
      continue;
    }

    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO meter_alerts
         (id, tenant_id, period_start, threshold_pct, usage_at_alert,
          projected_overage_cents, meter_alert_sent_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7)
       ON CONFLICT(tenant_id, period_start, threshold_pct) DO NOTHING`,
    )
      .bind(
        crypto.randomUUID(),
        row.tenant_id,
        row.period_start,
        ALERT_THRESHOLD_PCT,
        row.used,
        projectedOverageCents,
        nowIso,
      )
      .run();
    report.alerts_sent += 1;
  }

  return report;
}

async function sendQuotaEmail(
  env: Env,
  args: {
    to: string;
    tenantName: string;
    used: number;
    included: number;
    pct: number;
    projectedOverageCents: number;
    periodEnd: string;
  },
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const dollars = (args.projectedOverageCents / 100).toFixed(2);
  const html = `<p>Heads up — ${args.tenantName} is at <strong>${args.pct}%</strong> of its included monthly quota.</p>
<p>Current usage: <strong>${args.used.toLocaleString()}</strong> / ${args.included.toLocaleString()} requests.</p>
<p>If usage continues at this pace, projected overage this period is <strong>$${dollars}</strong> (period ends ${args.periodEnd}).</p>
<p><a href="${env.APP_BASE_URL}/dashboard/billing">View usage + upgrade options →</a></p>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: args.to,
      subject: `You're at ${args.pct}% of your monthly quota`,
      html,
    }),
  });
  return res.ok;
}
