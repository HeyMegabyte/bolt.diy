import type { Env } from '../../../src/types/env.js';
import { dbQueryOne } from '../../../src/services/db.js';
import type { OnboardingStep, OnboardingProgress } from './schemas.js';

interface CountRow { cnt: number }

export async function getOnboardingProgress(env: Env, orgId: string): Promise<OnboardingProgress> {
  const [siteRow, buildRow, domainRow, billingRow, memberRow] = await Promise.all([
    dbQueryOne<CountRow>(env.DB, `SELECT COUNT(*) as cnt FROM sites WHERE org_id = ? AND deleted_at IS NULL`, [orgId]),
    // "First build" = the org has a BUILT site. Single-site builds record via
    // sites.current_build_version (site-generation workflow), NOT workflow_jobs
    // (only batch ops write that, and its `type` column doesn't exist → the table
    // is empty). Count built sites so this reflects reality (was: workflow_jobs
    // `type='build'` → non-existent column → always 0 → step never completed).
    dbQueryOne<CountRow>(env.DB, `SELECT COUNT(*) as cnt FROM sites WHERE org_id = ? AND current_build_version IS NOT NULL AND deleted_at IS NULL`, [orgId]),
    dbQueryOne<CountRow>(env.DB, `SELECT COUNT(*) as cnt FROM hostnames h JOIN sites s ON s.id = h.site_id WHERE s.org_id = ? AND h.deleted_at IS NULL AND s.deleted_at IS NULL AND h.status = 'active'`, [orgId]),
    dbQueryOne<CountRow>(env.DB, `SELECT COUNT(*) as cnt FROM subscriptions WHERE org_id = ? AND status = 'active' AND deleted_at IS NULL`, [orgId]),
    dbQueryOne<CountRow>(env.DB, `SELECT COUNT(*) as cnt FROM memberships WHERE org_id = ? AND deleted_at IS NULL`, [orgId]),
  ]);

  const steps: OnboardingStep[] = [
    { key: 'site_created', label: 'Create your first site', completed: Number(siteRow?.cnt ?? 0) > 0, detail: siteRow ? `${siteRow.cnt} site(s)` : null },
    { key: 'first_build', label: 'Run your first build', completed: Number(buildRow?.cnt ?? 0) > 0, detail: buildRow ? `${buildRow.cnt} build(s)` : null },
    { key: 'domain_added', label: 'Add a custom domain', completed: Number(domainRow?.cnt ?? 0) > 0, detail: domainRow ? `${domainRow.cnt} domain(s)` : null },
    { key: 'billing_set', label: 'Set up billing', completed: Number(billingRow?.cnt ?? 0) > 0, detail: null },
    { key: 'team_invited', label: 'Invite a team member', completed: Number(memberRow?.cnt ?? 0) > 1, detail: memberRow ? `${memberRow.cnt} member(s)` : null },
  ];

  const completed = steps.filter((s) => s.completed).length;
  return { steps, completed, total: steps.length, pct: Math.round((completed / steps.length) * 100) };
}
