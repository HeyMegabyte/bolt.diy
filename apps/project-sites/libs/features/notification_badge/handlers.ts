import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { getBadgeCounts } from './service.js';

export async function handleBadge(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  if (!(await isFlagOn(c.env, 'notification_badge', { orgId: c.get('orgId')! }))) return c.notFound();
  return c.json(await getBadgeCounts(c.env, c.get('orgId')!));
}
