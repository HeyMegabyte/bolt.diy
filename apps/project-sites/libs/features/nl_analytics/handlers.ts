import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { QueryRequestSchema } from './schemas.js';
import { parseQuery } from './service.js';
import { dbQuery } from '../../../src/services/db.js';

export async function handleAnalyticsQuery(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  if (!(await isFlagOn(c.env, 'nl_analytics', { orgId: c.get('orgId')! }))) return c.notFound();
  const body = QueryRequestSchema.parse(await c.req.json());
  const parsed = parseQuery(body.question);
  try {
    const rows = await dbQuery(c.env.DB, parsed.sql, [c.get('orgId')!]);
    return c.json({ ...parsed, results: rows.data ?? [] });
  } catch {
    return c.json({ ...parsed, results: [], error: 'Query execution failed' });
  }
}
