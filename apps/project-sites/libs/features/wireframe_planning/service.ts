/**
 * @module libs/features/wireframe_planning/service
 * @description Business logic for the wireframe_planning feature.
 *
 * `buildWireframePlan` generates an ordered section list from a prompt, persists
 * the plan to D1, and returns the typed plan object.  Intentionally thin: the
 * AI-generation step will eventually call a Workers AI model here; for now it
 * returns a deterministic default set that the generation pipeline can override.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbInsert, dbQueryOne } from '../../../src/services/db.js';
import type { WireframePlan } from './schemas.js';

/** Feature flag key — must match the D1 `feature_flags.key` seed row. */
export const FLAG_KEY = 'wireframe_planning';

/** Default sections emitted when no model inference is run yet. */
const DEFAULT_SECTIONS: string[] = ['Hero', 'About', 'Services', 'Contact'];

/**
 * Generate and persist a wireframe plan for a site.
 *
 * @remarks
 * Upserts by site_id: if a plan already exists for the site, a new row is
 * created with a fresh ID (append-only audit trail).  The returned object
 * reflects the row just inserted.
 *
 * @param env - Worker environment bindings (requires `DB`).
 * @param siteId - The site this plan belongs to.
 * @param prompt - Owner-supplied description used to derive sections.
 * @returns The persisted wireframe plan.
 *
 * @throws If the D1 insert fails.
 */
export async function buildWireframePlan(
  env: Env,
  siteId: string,
  prompt: string,
): Promise<WireframePlan> {
  const id = crypto.randomUUID();
  const sections = DEFAULT_SECTIONS;
  const createdAt = new Date().toISOString();

  await dbInsert(env.DB, 'wireframe_plans', {
    id,
    site_id: siteId,
    prompt,
    sections: JSON.stringify(sections),
    created_at: createdAt,
    updated_at: createdAt,
  });

  return { id, siteId, prompt, sections, createdAt };
}

/**
 * Retrieve the most-recent wireframe plan for a site.
 *
 * @param env - Worker environment bindings (requires `DB`).
 * @param siteId - The site to look up.
 * @returns The latest plan, or `null` when none exists.
 */
export async function getWireframePlan(
  env: Env,
  siteId: string,
): Promise<WireframePlan | null> {
  const row = await dbQueryOne<{
    id: string;
    site_id: string;
    prompt: string;
    sections: string;
    created_at: string;
  }>(
    env.DB,
    'SELECT id, site_id, prompt, sections, created_at FROM wireframe_plans WHERE site_id = ? ORDER BY created_at DESC LIMIT 1',
    [siteId],
  );

  if (!row) return null;

  return {
    id: row.id,
    siteId: row.site_id,
    prompt: row.prompt,
    sections: JSON.parse(row.sections) as string[],
    createdAt: row.created_at,
  };
}
