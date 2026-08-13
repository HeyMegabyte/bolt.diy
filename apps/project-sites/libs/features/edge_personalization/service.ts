import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbExecute } from '../../../src/services/db.js';
import type { PersonalizationSignals, VariantRule } from './schemas.js';

export const FLAG_KEY = 'edge_personalization';

export async function upsertVariants(env: Env, siteId: string, variants: VariantRule[]): Promise<number> {
  await dbExecute(env.DB, 'DELETE FROM site_personalization_variants WHERE site_id = ?', [siteId]);
  for (const v of variants) {
    await dbExecute(
      env.DB,
      `INSERT INTO site_personalization_variants (id, site_id, name, conditions, priority, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [v.id, siteId, v.name, JSON.stringify(v.conditions), v.priority],
    );
  }
  return variants.length;
}

export async function listVariants(
  env: Env,
  siteId: string,
): Promise<Array<{ id: string; name: string; conditions: Record<string, unknown>; priority: number }>> {
  const { data } = await dbQuery<{ id: string; name: string; conditions: string; priority: number }>(
    env.DB,
    'SELECT id, name, conditions, priority FROM site_personalization_variants WHERE site_id = ? ORDER BY priority DESC',
    [siteId],
  ).catch(() => ({ data: [] as { id: string; name: string; conditions: string; priority: number }[] }));

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    conditions: JSON.parse(row.conditions ?? '{}') as Record<string, unknown>,
    priority: row.priority,
  }));
}

export async function resolveVariant(
  env: Env,
  siteId: string,
  signals: PersonalizationSignals,
): Promise<{ variantId: string; variantName: string }> {
  const { data } = await dbQuery<{ id: string; name: string; conditions: string; priority: number }>(
    env.DB,
    'SELECT id, name, conditions, priority FROM site_personalization_variants WHERE site_id = ? ORDER BY priority DESC',
    [siteId],
  ).catch(() => ({ data: [] as { id: string; name: string; conditions: string; priority: number }[] }));

  for (const row of data) {
    const cond = JSON.parse(row.conditions ?? '{}') as Partial<PersonalizationSignals>;
    const matches =
      (!cond.geo || cond.geo === signals.geo) &&
      (!cond.device || cond.device === signals.device) &&
      (!cond.referrer || (signals.referrer ?? '').includes(cond.referrer)) &&
      (cond.hour === undefined || cond.hour === signals.hour) &&
      (cond.isReturn === undefined || cond.isReturn === signals.isReturn);
    if (matches) return { variantId: row.id, variantName: row.name };
  }

  return { variantId: 'default', variantName: 'Default' };
}
