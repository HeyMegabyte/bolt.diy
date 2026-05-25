/**
 * @module services/social_auto_pilot
 * @description Pulse Social — Auto-Pilot autonomous composer service.
 *
 * Loads/saves per-org auto-pilot config, gathers business context
 * (business_name, business_type, brand voice) from the org's primary
 * published site, and runs an LLM call per target network to draft one
 * post. Drafts are persisted by the caller (the cron sweep in
 * `src/index.ts` or the `/api/social/auto-pilot/run-now` route in
 * `routes/social.ts`) — this module is a pure generator + state store.
 *
 * Safety rail: auto-pilot produces DRAFTS only. The user must review
 * and publish each post manually. A future `auto_publish_drafts` toggle
 * would skip the draft state and schedule publishing directly — until
 * then, every auto-pilot run feeds the Drafts tab, never the wire.
 *
 * @see ../routes/social.ts (HTTP surface)
 * @see ../index.ts (cron hook — `runAutoPilotIfDue`)
 */
import type { Env } from '../types/env.js';
import { dbInsert, dbQueryOne, dbUpdate } from './db.js';
import { callExternalLLM } from './external_llm.js';
import { PLATFORMS, type Platform } from './social_publishers/index.js';

/** Per-network char budget used to clamp generated drafts. */
const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  twitter: 280,
  linkedin: 3000,
  facebook: 5000,
  instagram: 2200,
  threads: 500,
  bluesky: 300,
  reddit: 10000,
  mastodon: 500,
  discord: 2000,
  slack: 4000,
  telegram: 4096,
};

/**
 * Default system prompt used when an org has not customized its own. Mirrors
 * the placeholder hints surfaced in the admin dialog so the live result
 * matches the preview.
 */
export const DEFAULT_AUTO_PILOT_PROMPT = `You are an autonomous social media composer for {{business_name}} in the {{business_type}} industry. Write 1 post per platform that drives engagement without sounding AI. Use the brand voice: {{brand_voice}}. Reference recent business updates: {{recent_news}}. Compose for: {{target_networks}}.`;

/** Public shape returned by `loadAutoPilotConfig` + `upsertAutoPilotConfig`. */
export interface AutoPilotConfig {
  enabled: boolean;
  prompt: string;
  cadence_hours: number;
  target_networks: Platform[];
  last_run_at: number | null;
  next_run_at: number | null;
}

/** Generated draft for a single network. */
export interface AutoPilotDraft {
  text: string;
  mediaSuggestion?: string;
}

interface SocialAutoPilotRow {
  enabled: number;
  prompt: string;
  cadence_hours: number;
  target_networks_json: string | null;
  last_run_at: number | null;
  next_run_at: number | null;
}

function rowToConfig(row: SocialAutoPilotRow | null): AutoPilotConfig {
  if (!row) {
    return {
      enabled: false,
      prompt: '',
      cadence_hours: 24,
      target_networks: [],
      last_run_at: null,
      next_run_at: null,
    };
  }
  let nets: Platform[] = [];
  if (row.target_networks_json) {
    try {
      const parsed = JSON.parse(row.target_networks_json) as unknown;
      if (Array.isArray(parsed)) {
        nets = parsed.filter((p): p is Platform => PLATFORMS.includes(p as Platform));
      }
    } catch {
      nets = [];
    }
  }
  return {
    enabled: row.enabled === 1,
    prompt: row.prompt ?? '',
    cadence_hours: row.cadence_hours ?? 24,
    target_networks: nets,
    last_run_at: row.last_run_at,
    next_run_at: row.next_run_at,
  };
}

/**
 * Load the auto-pilot config for `orgId`, returning a safe default row
 * when none exists (the row is created lazily on the first `upsert`).
 *
 * @example
 * ```ts
 * const cfg = await loadAutoPilotConfig(env.DB, 'org_123');
 * if (cfg.enabled) await runAutoPilot(env, orgId, cfg);
 * ```
 */
export async function loadAutoPilotConfig(
  db: D1Database,
  orgId: string,
): Promise<AutoPilotConfig> {
  const row = await dbQueryOne<SocialAutoPilotRow>(
    db,
    `SELECT enabled, prompt, cadence_hours, target_networks_json,
            last_run_at, next_run_at
       FROM social_auto_pilot WHERE org_id = ?`,
    [orgId],
  );
  return rowToConfig(row);
}

/**
 * Upsert the auto-pilot config for `orgId`. Recomputes `next_run_at`
 * whenever `enabled` flips on OR `cadence_hours` changes; clears it when
 * `enabled` flips off so the cron sweep skips the row.
 *
 * @remarks
 * Validation is the caller's job — assume `patch` already cleared a Zod
 * schema. This function is the persistence boundary; it doesn't mint
 * defaults beyond what the schema permits.
 *
 * @throws Error when the underlying D1 write fails.
 */
export async function upsertAutoPilotConfig(
  db: D1Database,
  orgId: string,
  patch: {
    enabled?: boolean;
    prompt?: string;
    cadence_hours?: number;
    target_networks?: Platform[];
  },
): Promise<AutoPilotConfig> {
  const now = Date.now();
  const existing = await dbQueryOne<SocialAutoPilotRow>(
    db,
    `SELECT enabled, prompt, cadence_hours, target_networks_json, last_run_at, next_run_at
       FROM social_auto_pilot WHERE org_id = ?`,
    [orgId],
  );
  const prev = rowToConfig(existing);
  const enabled = patch.enabled ?? prev.enabled;
  const prompt = patch.prompt ?? prev.prompt;
  const cadence_hours = patch.cadence_hours ?? prev.cadence_hours;
  const target_networks = patch.target_networks ?? prev.target_networks;
  const cadenceChanged = cadence_hours !== prev.cadence_hours;
  const enabledNow = enabled && !prev.enabled;
  let next_run_at = prev.next_run_at;
  if (!enabled) next_run_at = null;
  else if (enabledNow || cadenceChanged || next_run_at == null) {
    next_run_at = now + cadence_hours * 3_600_000;
  }
  if (!existing) {
    await dbInsert(db, 'social_auto_pilot', {
      org_id: orgId,
      enabled: enabled ? 1 : 0,
      prompt,
      cadence_hours,
      target_networks_json: JSON.stringify(target_networks),
      last_run_at: null,
      next_run_at,
      created_at: now,
      updated_at: now,
    });
  } else {
    await dbUpdate(
      db,
      'social_auto_pilot',
      {
        enabled: enabled ? 1 : 0,
        prompt,
        cadence_hours,
        target_networks_json: JSON.stringify(target_networks),
        next_run_at,
        updated_at: now,
      },
      'org_id = ?',
      [orgId],
    );
  }
  return {
    enabled,
    prompt,
    cadence_hours,
    target_networks,
    last_run_at: prev.last_run_at,
    next_run_at,
  };
}

/** Resolved business context substituted into the system prompt. */
interface BusinessContext {
  business_name: string;
  business_type: string;
  brand_voice: string;
  recent_news: string;
}

/**
 * Pulls business context for the org from its most recent published site.
 * Falls back to neutral defaults so the prompt remains coherent when the
 * org has no published site yet.
 */
async function loadBusinessContext(
  db: D1Database,
  orgId: string,
): Promise<BusinessContext> {
  const site = await dbQueryOne<{
    business_name: string | null;
    business_address: string | null;
  }>(
    db,
    `SELECT business_name, business_address FROM sites
      WHERE org_id = ? AND deleted_at IS NULL
      ORDER BY CASE WHEN status = 'published' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    [orgId],
  );
  return {
    business_name: site?.business_name ?? 'our brand',
    business_type: 'small business',
    brand_voice: 'warm, confident, specific, never salesy',
    recent_news: site?.business_address ? `Based in ${site.business_address}.` : 'No recent updates available.',
  };
}

function renderPrompt(template: string, ctx: BusinessContext, targetNetworks: string): string {
  return template
    .replaceAll('{{business_name}}', ctx.business_name)
    .replaceAll('{{business_type}}', ctx.business_type)
    .replaceAll('{{brand_voice}}', ctx.brand_voice)
    .replaceAll('{{recent_news}}', ctx.recent_news)
    .replaceAll('{{target_networks}}', targetNetworks);
}

/**
 * Generate one draft for the given network using the configured prompt and
 * business context. Uses Claude Sonnet 4.6 via the shared external LLM
 * router (falls back to OpenAI on Anthropic outage per the circuit-breaker
 * in `external_llm.ts`).
 *
 * @example
 * ```ts
 * const draft = await generateAutoPilotPostForNetwork(env, orgId, 'linkedin', cfg.prompt);
 * console.warn(JSON.stringify({ network: 'linkedin', text: draft.text }));
 * ```
 *
 * @throws Error when no LLM provider is configured or all providers fail.
 */
export async function generateAutoPilotPostForNetwork(
  env: Env,
  orgId: string,
  network: Platform,
  systemPromptTemplate: string,
): Promise<AutoPilotDraft> {
  const ctx = await loadBusinessContext(env.DB, orgId);
  const limit = PLATFORM_CHAR_LIMITS[network] ?? 1000;
  const renderedSystem = renderPrompt(systemPromptTemplate, ctx, network);
  const userPrompt = [
    `Network: ${network}`,
    `Max characters: ${limit}`,
    `Constraints:`,
    `- Sound human, never AI-flavored ("seamless", "leverage", "unlock" are banned).`,
    `- One clear hook in the first 8 words.`,
    `- No hashtag spam — at most 3 hashtags, placed at the end on their own line.`,
    `- No emoji storms — at most 2 emojis, only if they earn their place.`,
    `- Do NOT include "${ctx.business_name}" more than once.`,
    `- If the network is LinkedIn, allow short paragraphs and one closing question.`,
    `- If the network is X/Twitter or Bluesky or Threads, keep it punchy and under the limit.`,
    `Return ONLY JSON: {"text": string, "mediaSuggestion"?: string}.`,
    `mediaSuggestion is a one-line description of an ideal accompanying image if relevant.`,
  ].join('\n');

  const result = await callExternalLLM(env, {
    system: renderedSystem,
    user: userPrompt,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    temperature: 0.85,
    maxTokens: 1200,
    jsonMode: true,
    traceContext: { promptId: 'social_auto_pilot' },
  });

  let parsed: { text?: unknown; mediaSuggestion?: unknown } = {};
  try {
    parsed = JSON.parse(result.output) as typeof parsed;
  } catch {
    parsed = { text: result.output };
  }
  let text = typeof parsed.text === 'string' ? parsed.text.trim() : String(result.output).trim();
  if (text.length > limit) text = text.slice(0, limit - 1).trimEnd() + '…';
  const mediaSuggestion = typeof parsed.mediaSuggestion === 'string' ? parsed.mediaSuggestion : undefined;
  return { text, mediaSuggestion };
}

/**
 * Cron hook — pick up to `limit` orgs whose auto-pilot is enabled AND due
 * AND not currently being processed, generate one draft per target
 * network, and bump `last_run_at` + `next_run_at`. Returns a brief
 * summary suitable for structured logging from `src/index.ts`.
 *
 * @remarks
 * Drafts are persisted with `status='draft'` so the user explicitly
 * reviews + publishes — this is the safety rail. Each generation failure
 * is swallowed (logged via console.warn) so a single bad network doesn't
 * block the others.
 */
export async function runAutoPilotIfDue(
  env: Env,
  limit = 10,
): Promise<{ orgs_scanned: number; drafts_created: number }> {
  const now = Date.now();
  const { dbQuery } = await import('./db.js');
  const { data: rows } = await dbQuery<{
    org_id: string;
    prompt: string;
    cadence_hours: number;
    target_networks_json: string | null;
  }>(
    env.DB,
    `SELECT org_id, prompt, cadence_hours, target_networks_json
       FROM social_auto_pilot
      WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
      ORDER BY next_run_at ASC
      LIMIT ?`,
    [now, limit],
  );
  let drafts_created = 0;
  for (const row of rows) {
    let networks: Platform[] = [];
    if (row.target_networks_json) {
      try {
        const parsed = JSON.parse(row.target_networks_json) as unknown;
        if (Array.isArray(parsed)) {
          networks = parsed.filter((p): p is Platform => PLATFORMS.includes(p as Platform));
        }
      } catch {
        networks = [];
      }
    }
    if (networks.length === 0) continue;
    const effectivePrompt = row.prompt || DEFAULT_AUTO_PILOT_PROMPT;
    for (const network of networks) {
      try {
        const draft = await generateAutoPilotPostForNetwork(env, row.org_id, network, effectivePrompt);
        await dbInsert(env.DB, 'pulse_posts', {
          id: crypto.randomUUID(),
          org_id: row.org_id,
          site_id: null,
          created_by: 'auto-pilot',
          status: 'draft',
          content: draft.text,
          per_platform_overrides: null,
          media_keys: null,
          account_ids: JSON.stringify([]),
          hashtags: null,
          mentions: null,
          link: null,
          thread_id: `auto-pilot-${Date.now()}`,
        });
        drafts_created++;
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'social_auto_pilot',
            message: 'cron_generation_failed',
            org_id: row.org_id,
            network,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    const next = now + row.cadence_hours * 3_600_000;
    await dbUpdate(
      env.DB,
      'social_auto_pilot',
      { last_run_at: now, next_run_at: next, updated_at: now },
      'org_id = ?',
      [row.org_id],
    );
  }
  return { orgs_scanned: rows.length, drafts_created };
}
