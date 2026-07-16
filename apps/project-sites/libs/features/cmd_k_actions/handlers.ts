import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { CmdKQuerySchema } from './schemas.js';
import { suggestActions } from './service.js';

export async function handleCmdK(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  if (!(await isFlagOn(c.env, 'cmd_k_actions', { orgId: c.get('orgId')! }))) return c.notFound();
  const { q } = CmdKQuerySchema.parse(await c.req.json());
  return c.json({ suggestions: await suggestActions(c.env, c.get('orgId')!, q) });
}
