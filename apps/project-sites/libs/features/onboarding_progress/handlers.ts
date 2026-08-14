import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { getOnboardingProgress } from './service.js';

export async function handleOnboardingProgress(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<Response> {
  if (!(await isFlagOn(c.env, 'onboarding_copilot', { orgId: c.get('orgId')! }))) return c.notFound();
  return c.json(await getOnboardingProgress(c.env, c.get('orgId')!));
}
