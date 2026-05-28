/**
 * Swarm Editor + Live-stream Preview routes (#5 + #6).
 *
 * Routes:
 *   POST /api/swarm/:siteId/start     → start 7-specialist swarm run
 *   GET  /api/swarm/:siteId/stream    → SSE (per-specialist progress + component delivery)
 *   GET  /api/swarm/:siteId/runs      → run history
 *   GET  /api/swarm/:siteId/run/:runId → run detail + live events
 *
 * Flags:
 *   - `swarm_editor`              → enabled gated POST + SSE (extended swarm)
 *   - `multi_agent_concurrent`    → read-only list/detail always available when flag on
 *   - `progressive_skeleton_build`→ enables the component-stream SSE mode
 *
 * Per [[feature-flags]] all flags default enabled=0, rollout=0, stage='experimental'.
 * Server guard: returns 404 (not 403) when flag is off.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import {
  startMultiAgentRun,
  listMultiAgentRuns,
  getMultiAgentRunDetail,
  buildSwarmSseStream,
  buildProgressiveSseStream,
  SPECIALIST_PARTITION,
  type SwarmSpecialist,
} from '../services/ide_sandbox.js';

const swarm = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── POST /api/swarm/:siteId/start ──────────────────────────────────────────

const VALID_AGENTS = ['visual', 'copy', 'seo', 'a11y', 'motion', 'media', 'qa'] as const;

const SwarmStartBodySchema = z.object({
  prompt: z.string().max(4000).optional(),
  agents: z.array(z.enum(VALID_AGENTS)).min(1).max(7).optional(),
});
type SwarmStartInput = z.infer<typeof SwarmStartBodySchema>;

swarm.post('/api/swarm/:siteId/start', zValidator('json', SwarmStartBodySchema), async (c) => {
  // Flag gate — 404 when off (per [[feature-flags]] never 403)
  const flagRow = await c.env.DB.prepare(
    "SELECT enabled FROM feature_flags WHERE key = 'swarm_editor' LIMIT 1",
  ).first<{ enabled: number }>().catch(() => null);
  if (!flagRow?.enabled) return c.json({ error: { code: 'NOT_FOUND', message: 'swarm_editor not enabled' } }, 404);

  const siteId = c.req.param('siteId');
  const body = c.req.valid('json') as SwarmStartInput;
  const allAgents: SwarmSpecialist[] = ['visual', 'copy', 'seo', 'a11y', 'motion', 'media', 'qa'];
  const prompt = (body.prompt ?? '').trim() || 'Improve the site with all specialists in parallel';
  const agents = ((body.agents ?? allAgents) as string[]).filter((a: string) => a in SPECIALIST_PARTITION) as SwarmSpecialist[];
  if (!agents.length) return c.json({ error: { code: 'BAD_REQUEST', message: 'No valid agents specified' } }, 400);

  const run = await startMultiAgentRun(c.env, { siteId, agents, prompt });
  return c.json(run, 201);
});

// ── GET /api/swarm/:siteId/stream ─────────────────────────────────────────

swarm.get('/api/swarm/:siteId/stream', async (c) => {
  const siteId = c.req.param('siteId');
  const runId = c.req.query('run_id') ?? null;
  const mode = c.req.query('mode') ?? 'swarm'; // 'swarm' | 'progressive'

  // Flag gate
  const flagKey = mode === 'progressive' ? 'progressive_skeleton_build' : 'swarm_editor';
  const flagRow = await c.env.DB.prepare(
    'SELECT enabled FROM feature_flags WHERE key = ? LIMIT 1',
  ).bind(flagKey).first<{ enabled: number }>().catch(() => null);
  if (!flagRow?.enabled) return c.json({ error: { code: 'NOT_FOUND', message: `${flagKey} not enabled` } }, 404);

  const stream =
    mode === 'progressive'
      ? buildProgressiveSseStream(c.env, siteId)
      : buildSwarmSseStream(c.env, siteId, runId);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// ── GET /api/swarm/:siteId/runs ───────────────────────────────────────────

swarm.get('/api/swarm/:siteId/runs', async (c) => {
  const flagRow = await c.env.DB.prepare(
    "SELECT enabled FROM feature_flags WHERE key = 'multi_agent_concurrent' LIMIT 1",
  ).first<{ enabled: number }>().catch(() => null);
  if (!flagRow?.enabled) return c.json({ error: { code: 'NOT_FOUND', message: 'multi_agent_concurrent not enabled' } }, 404);

  const siteId = c.req.param('siteId');
  const runs = await listMultiAgentRuns(c.env, siteId);
  return c.json({ runs, specialists: SPECIALIST_PARTITION });
});

// ── GET /api/swarm/:siteId/run/:runId ─────────────────────────────────────

swarm.get('/api/swarm/:siteId/run/:runId', async (c) => {
  const flagRow = await c.env.DB.prepare(
    "SELECT enabled FROM feature_flags WHERE key = 'multi_agent_concurrent' LIMIT 1",
  ).first<{ enabled: number }>().catch(() => null);
  if (!flagRow?.enabled) return c.json({ error: { code: 'NOT_FOUND', message: 'multi_agent_concurrent not enabled' } }, 404);

  const runId = c.req.param('runId');
  const detail = await getMultiAgentRunDetail(c.env, runId);
  return c.json(detail);
});

export { swarm };
export default swarm;
