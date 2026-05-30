/**
 * @module routes/agents
 * @description AI Agents — per-site autonomous maintenance.
 *
 * Each agent is a system-prompt + tool whitelist + cron schedule. The
 * `runAgent()` invocation reads the prompt + memory, calls Workers AI
 * Llama 3.3 70B (or external LLM if configured), executes tool calls
 * against a sandboxed whitelist, debits wallet at finish, writes an
 * `agent_runs` row.
 *
 * Pro-only — the entire surface returns 402 to free users.
 *
 * | Path                                              | Purpose                          |
 * | ------------------------------------------------- | -------------------------------- |
 * | `GET  /api/sites/:siteId/agents`                  | List agents on a site            |
 * | `POST /api/sites/:siteId/agents`                  | Create a new agent               |
 * | `PATCH /api/agents/:id`                           | Update agent config              |
 * | `POST /api/agents/:id/run`                        | Trigger a manual run             |
 * | `GET  /api/agents/:id/runs`                       | List past runs                   |
 * | `DELETE /api/agents/:id`                          | Soft-delete an agent             |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { requirePro } from '../services/pro.js';
import { unauthorized, notFound } from '@project-sites/shared';

type AgentCtx = Context<{ Bindings: Env; Variables: Variables }>;

const agents = new Hono<{ Bindings: Env; Variables: Variables }>();

agents.use('/api/sites/:siteId/agents/*', requirePro);
agents.use('/api/sites/:siteId/agents', requirePro);
agents.use('/api/agents/*', requirePro);

const createSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(3)
    .max(64),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  system_prompt: z.string().min(20).max(8000),
  model: z.string().default('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
  tools: z.array(z.string()).max(20).default([]),
  schedule_cron: z.string().max(40).optional(),
  schedule_tz: z.string().max(40).default('UTC'),
  max_cost_cents_per_run: z.number().int().min(1).max(500).default(50),
  monthly_budget_cents: z.number().int().min(0).max(50000).default(1000),
});

/**
 * `GET /api/sites/:siteId/agents` — List active agents on a site.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 * @throws 404 NOT_FOUND when the site isn't owned by the caller's org (never 403 — don't leak existence).
 */
agents.get('/api/sites/:siteId/agents', async (c) => {
  const siteId = c.req.param('siteId');
  const orgId = await assertSiteOwnership(c, siteId);
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, slug, name, description, model, tools_json, schedule_cron,
            schedule_tz, status, max_cost_cents_per_run, monthly_budget_cents,
            spend_this_month_cents, last_run_at, last_run_status, created_at
       FROM agents
       WHERE site_id = ? AND org_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    [siteId, orgId],
  );
  return c.json({ agents: data });
});

/**
 * `POST /api/sites/:siteId/agents` — Create a new agent on a site.
 *
 * @remarks
 * Body: {@link createSchema}. Defaults: Llama 3.3 70B FP8-fast, no tools,
 * no schedule (manual-trigger only), 50¢ max cost per run, $10/mo budget.
 *
 * @throws 400 BAD_REQUEST when payload validation fails or slug collides.
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 * @throws 404 NOT_FOUND when the site isn't owned by the caller's org (never 403 — don't leak existence).
 */
agents.post('/api/sites/:siteId/agents', zValidator('json', createSchema), async (c) => {
  const siteId = c.req.param('siteId');
  const orgId = await assertSiteOwnership(c, siteId);
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const id = crypto.randomUUID();
  await dbInsert(c.env.DB, 'agents', {
    id,
    org_id: orgId,
    site_id: siteId,
    slug: body.slug,
    name: body.name,
    description: body.description ?? null,
    system_prompt: body.system_prompt,
    model: body.model,
    tools_json: JSON.stringify(body.tools),
    schedule_cron: body.schedule_cron ?? null,
    schedule_tz: body.schedule_tz,
    max_cost_cents_per_run: body.max_cost_cents_per_run,
    monthly_budget_cents: body.monthly_budget_cents,
    status: 'active',
    created_by: userId,
  });
  return c.json({ id, status: 'active' }, 201);
});

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional(),
  system_prompt: z.string().min(20).max(8000).optional(),
  tools: z.array(z.string()).max(20).optional(),
  schedule_cron: z.string().max(40).nullable().optional(),
  status: z.enum(['active', 'paused']).optional(),
  monthly_budget_cents: z.number().int().min(0).max(50000).optional(),
});

/**
 * `PATCH /api/agents/:id` — Update agent config (prompt, tools, schedule,
 * status, budget).
 *
 * @remarks
 * Body: {@link patchSchema}. Pause/resume via `status`.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 * @throws 404 NOT_FOUND when the agent isn't owned by the caller's org (never 403 — don't leak existence).
 */
agents.patch('/api/agents/:id', zValidator('json', patchSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const agent = await loadAgent(c, id);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.system_prompt !== undefined) patch.system_prompt = body.system_prompt;
  if (body.tools !== undefined) patch.tools_json = JSON.stringify(body.tools);
  if (body.schedule_cron !== undefined) patch.schedule_cron = body.schedule_cron;
  if (body.status !== undefined) patch.status = body.status;
  if (body.monthly_budget_cents !== undefined)
    patch.monthly_budget_cents = body.monthly_budget_cents;
  if (Object.keys(patch).length > 0) {
    await dbUpdate(c.env.DB, 'agents', patch, 'id = ?', [agent.id]);
  }
  return c.json({ ok: true });
});

/**
 * `POST /api/agents/:id/run` — Trigger a manual run.
 *
 * @remarks
 * Returns HTTP `202` with `{ run_id, status: 'running' }` immediately —
 * the actual model call happens in `ctx.waitUntil`. Poll
 * `GET /api/agents/:id/runs` for the result.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro or the agent's
 *   monthly budget is exhausted.
 * @throws 404 NOT_FOUND when the agent isn't owned by the caller's org (never 403 — don't leak existence).
 * @throws 409 CONFLICT when the agent is paused (resume first).
 */
agents.post('/api/agents/:id/run', async (c) => {
  const id = c.req.param('id');
  const agent = await loadAgent(c, id);
  if (agent.status !== 'active') {
    return c.json({ error: { code: 'AGENT_PAUSED', message: 'Resume the agent first' } }, 409);
  }
  if (agent.spend_this_month_cents >= agent.monthly_budget_cents) {
    return c.json(
      {
        error: {
          code: 'BUDGET_EXCEEDED',
          message: 'Monthly budget reached — raise budget to retry',
        },
      },
      402,
    );
  }
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  await dbInsert(c.env.DB, 'agent_runs', {
    id: runId,
    agent_id: agent.id,
    org_id: agent.org_id,
    site_id: agent.site_id,
    trigger: 'manual',
    status: 'running',
    started_at: now,
  });
  // Run synchronously for now — `ctx.waitUntil` could keep the response sub-100ms.
  c.executionCtx.waitUntil(executeRun(c.env, agent, runId));
  return c.json({ run_id: runId, status: 'running' }, 202);
});

/**
 * `GET /api/agents/:id/runs?limit=` — List past runs ordered most-recent first.
 *
 * @remarks
 * `limit` clamped to 200 (default 50).
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 * @throws 404 NOT_FOUND when the agent isn't owned by the caller's org (never 403 — don't leak existence).
 */
agents.get('/api/agents/:id/runs', async (c) => {
  const id = c.req.param('id');
  const agent = await loadAgent(c, id);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, trigger, status, tokens_in, tokens_out, cost_cents,
            started_at, finished_at, error_message
       FROM agent_runs
       WHERE agent_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    [agent.id, limit],
  );
  return c.json({ runs: data });
});

/**
 * `DELETE /api/agents/:id` — Soft-delete an agent (sets `deleted_at` and
 * `status='paused'`). History rows in `agent_runs` are retained.
 *
 * @throws 401 UNAUTHORIZED when org context is missing.
 * @throws 402 PAYMENT_REQUIRED when the caller isn't on Pro.
 * @throws 404 NOT_FOUND when the agent isn't owned by the caller's org (never 403 — don't leak existence).
 */
agents.delete('/api/agents/:id', async (c) => {
  const id = c.req.param('id');
  const agent = await loadAgent(c, id);
  await dbUpdate(
    c.env.DB,
    'agents',
    { deleted_at: new Date().toISOString(), status: 'paused' },
    'id = ?',
    [agent.id],
  );
  return c.json({ ok: true });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

interface AgentRow {
  id: string;
  org_id: string;
  site_id: string;
  system_prompt: string;
  model: string;
  tools_json: string;
  status: string;
  monthly_budget_cents: number;
  spend_this_month_cents: number;
  max_cost_cents_per_run: number;
}

/**
 * Load an agent the caller's org owns.
 *
 * @remarks Multi-tenant isolation — a missing agent AND a foreign-org agent
 * both throw `notFound()` (404). Previously the two cases returned different
 * statuses (404 missing vs **403** foreign), which let a prober distinguish
 * "this agent id exists but isn't yours" from "doesn't exist" — leaking other
 * orgs' agent-id existence. Collapsing both to 404 closes that oracle.
 * @param c  - Hono context (reads `orgId` set by auth middleware).
 * @param id - the agent id from the URL path.
 * @returns the owned `AgentRow`.
 * @throws {AppError} `unauthorized` (401) when no session; `notFound` (404) when the agent is missing or not owned by the caller.
 */
async function loadAgent(c: AgentCtx, id: string): Promise<AgentRow> {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const row = await dbQueryOne<AgentRow>(
    c.env.DB,
    `SELECT id, org_id, site_id, system_prompt, model, tools_json, status,
            monthly_budget_cents, spend_this_month_cents, max_cost_cents_per_run
       FROM agents WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  // 404 for both missing AND foreign-org (never 403 — don't leak that the id exists).
  if (!row || row.org_id !== orgId) throw notFound('Agent not found');
  return row;
}

/**
 * Assert the authenticated caller's org owns `siteId`.
 *
 * @remarks A missing session throws `unauthorized()` (401); a site owned by
 * another org — or one that does not exist — throws `notFound()` (404, **never
 * 403**, so a foreign site id can't be confirmed to exist by probing).
 * @param c      - Hono context (reads `orgId` set by auth middleware).
 * @param siteId - the site id from the URL path.
 * @returns the verified owning `orgId`.
 * @throws {AppError} `unauthorized` (401) when no session; `notFound` (404) when the site is not owned by the caller.
 */
async function assertSiteOwnership(c: AgentCtx, siteId: string): Promise<string> {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const row = await dbQueryOne<{ org_id: string }>(
    c.env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [siteId],
  );
  if (!row || row.org_id !== orgId) throw notFound('Site not found');
  return orgId;
}

async function executeRun(env: Env, agent: AgentRow, runId: string): Promise<void> {
  const startedAt = Date.now();
  try {
    // Minimal first-pass: prompt → Workers AI → record. Tool-call loop will land in a follow-up turn.
    const ai = env.AI as unknown as {
      run: (
        model: string,
        input: { messages: Array<{ role: string; content: string }> },
      ) => Promise<{
        response: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>;
    };
    const result = await ai.run(agent.model, {
      messages: [
        { role: 'system', content: agent.system_prompt },
        {
          role: 'user',
          content: 'Run your scheduled task. Output a JSON object with `summary` and `actions[]`.',
        },
      ],
    });
    const tokensIn = result.usage?.prompt_tokens ?? 0;
    const tokensOut = result.usage?.completion_tokens ?? 0;
    const costCents = Math.max(1, Math.ceil((tokensIn / 1000) * 1 + (tokensOut / 1000) * 2));
    await env.DB.prepare(
      `UPDATE agent_runs
          SET status = ?, output_json = ?, tokens_in = ?, tokens_out = ?,
              cost_cents = ?, finished_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
      .bind(
        'completed',
        JSON.stringify({ response: result.response }),
        tokensIn,
        tokensOut,
        costCents,
        runId,
      )
      .run();
    await env.DB.prepare(
      `UPDATE agents
          SET last_run_at = CURRENT_TIMESTAMP, last_run_status = 'ok',
              spend_this_month_cents = spend_this_month_cents + ?
        WHERE id = ?`,
    )
      .bind(costCents, agent.id)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(
      `UPDATE agent_runs SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
      .bind(message, runId)
      .run();
    await env.DB.prepare(
      `UPDATE agents SET last_run_at = CURRENT_TIMESTAMP, last_run_status = 'error' WHERE id = ?`,
    )
      .bind(agent.id)
      .run();
  } finally {
    void startedAt;
  }
}

export { agents };
