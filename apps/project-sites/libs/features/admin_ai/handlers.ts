/**
 * @module libs/features/admin_ai/handlers
 *
 * @description
 * Hono routes for the **admin AI assistant tools** — the dashboard's
 * bottom-right AI chat (single-turn), the AI trace-explainer, the
 * natural-language admin search, and the two Server-Sent-Events streaming
 * surfaces (the Cmd-K inline-answer palette and the floating chat widget with
 * tool-use). Every route requires both an `orgId` and a `userId` on the request
 * context — the {@link need} helper throws `HTTPError(401)` when either is
 * missing. These are org-scoped operator tools, not per-site owner tools, so
 * site ownership is confirmed inline (only ai-chat's optional `site_id` reads a
 * site row, org-scoped) rather than via the `siteOwned` guard.
 *
 * | Method | Path                                      | Auth         | Purpose                                                    |
 * | ------ | ----------------------------------------- | ------------ | ---------------------------------------------------------- |
 * | POST   | /api/admin/ai-chat                        | orgId+userId | Single-turn dashboard AI assistant (Workers AI)            |
 * | POST   | /api/admin/traces/:traceId/explain        | orgId+userId | 3-paragraph SRE explanation of an AI trace (D1+KV cached)  |
 * | POST   | /api/admin/search/ai                      | orgId+userId | NL → parameterised org-scoped D1 SELECT                    |
 * | POST   | /api/admin/ai/stream/palette              | orgId+userId | SSE: Cmd-K inline-answer stream (text/event-stream)        |
 * | POST   | /api/admin/ai/stream/chat                 | orgId+userId | SSE: floating chat widget stream + `<tool>` envelopes      |
 *
 * Extracted VERBATIM from the `ai_admin.ts` monolith (route-decomposition
 * installment 18) — only the route-registration receiver changed (`aiAdmin.` →
 * `adminAi.`); the handler bodies (and the module-level `EDITOR_TOOL_SURFACE`
 * const the streaming chat handler reads) are byte-for-byte unchanged. The two
 * SSE handlers keep their exact `ReadableStream` / `TransformStream` /
 * `text/event-stream` logic. The module imports its error/auth scaffolding (the
 * `HTTPError` class, the `need(c)` helper, and a byte-identical `onError`) from
 * the SHARED `src/lib/ai_admin_kit.ts` kit — no local copies — so behavior is
 * identical: it contains ONLY these ai_admin-sourced routes, so exact
 * reproduction = byte-identical behavior (no re-throw needed — this module has no
 * pre-existing shared-`AppError` routes to fall through to). Bodies are read via
 * a raw `as {…}` cast + `.catch(() => ({}))` rather than a Zod schema at the
 * boundary, so there is no `schemas.ts` — the moved handlers keep their original
 * in-body validation.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { HTTPError, need, aiAdminOnError } from '../../../src/lib/ai_admin_kit.js';
import { DEFAULT_CHAT_SYSTEM_PROMPT } from '../../../src/services/form_router.js';
import { DASHBOARD_PERSONA_SYSTEM_PROMPT } from '../../../src/prompts/dashboard_persona.js';
import { explainTrace, aiSearch, type AiTraceRow } from '../../../src/services/ai_admin_features.js';
import * as auditService from '../../../src/services/audit.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const adminAi = new Hono<AppContext>();

// Error/auth scaffolding (HTTPError · need · onError) is shared via
// src/lib/ai_admin_kit.ts — imported above (route-decomposition installment 18).
// Byte-identical behavior to the ai_admin.ts inline copies; see the kit module
// doc for the siteOwned-vs-requireOwnedSite rationale.
adminAi.onError(aiAdminOnError);

/* ────────────────────────── Admin AI Chat (bottom-right widget) ────────────────────────── */
/**
 * `POST /api/admin/ai-chat` — Dashboard AI assistant single-turn endpoint.
 *
 * @remarks
 * Body: `{ messages: Array<{role, content}>, site_id? }`. Uses Workers AI
 * with the {@link DASHBOARD_PERSONA_SYSTEM_PROMPT}. Site context is
 * scoped to the caller's org when `site_id` is supplied.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 *
 * @see {@link adminAi.post('/api/admin/ai/stream/chat')} for the streaming
 *   variant used by the live dashboard chat.
 */
adminAi.post('/api/admin/ai-chat', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    site_id?: string;
    messages?: { role: 'user' | 'assistant' | 'system'; content: string }[];
  };
  const msgs = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
  if (!msgs.length)
    return c.json({ error: { code: 'BAD_REQUEST', message: 'messages required' } }, 400);

  let persona = '';
  let systemPrompt = DEFAULT_CHAT_SYSTEM_PROMPT;
  if (body.site_id) {
    // Confirm the site belongs to this org, then read settings (single-table schema, site_id is PK).
    const owned = await c.env.DB.prepare(
      `SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    )
      .bind(body.site_id, orgId)
      .first();
    if (owned) {
      const row = await c.env.DB.prepare(
        `SELECT chat_persona, chat_system_prompt FROM ai_site_settings WHERE site_id = ?`,
      )
        .bind(body.site_id)
        .first<{ chat_persona: string | null; chat_system_prompt: string | null }>();
      if (row?.chat_persona) persona = row.chat_persona;
      if (row?.chat_system_prompt) systemPrompt = row.chat_system_prompt;
    }
  }

  // Persona prepended as the topmost system block — every dashboard chat call
  // reads from `prompts/dashboard_persona.ts` (single source of truth).
  const sysContent = [
    DASHBOARD_PERSONA_SYSTEM_PROMPT,
    systemPrompt,
    persona ? `Persona: ${persona}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const result = (await c.env.AI.run(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<typeof c.env.AI.run>[0],
      { messages: [{ role: 'system', content: sysContent }, ...msgs] } as Parameters<
        typeof c.env.AI.run
      >[1],
    )) as { response?: string };
    return c.json({ data: { reply: result?.response ?? '(no reply)' } });
  } catch (err) {
    return c.json({
      data: {
        reply: `(AI temporarily unavailable: ${err instanceof Error ? err.message : 'unknown'})`,
      },
    });
  }
});

/* ────────────────────────── #91 AI Explain Trace ────────────────────────── */

/**
 * POST /api/admin/traces/:traceId/explain
 *
 * Loads the trace row (org-scoped via ai_form_logs.org_id), feeds it to
 * Llama 3.3 70B (routed through AI Gateway via `env.AI.run`) with an
 * SRE-grade system prompt, and returns a 3-paragraph markdown explanation.
 *
 * Cache hierarchy (cheapest → most expensive):
 *   1. D1 column `ai_form_logs.explanation` (migration 0026) — permanent,
 *      paired with the trace row itself. A re-explain after KV eviction
 *      still costs zero LLM tokens.
 *   2. KV `trace:{id}:explain` — 1h hot window for cross-row reuse. Set
 *      by `explainTrace()` after every successful generation.
 *   3. Cold path — Workers AI Gateway call via `env.AI.run`.
 *
 * Response shape: `{ data: { markdown, model, cached } }`. `cached: true`
 * means EITHER the D1 column OR the KV hit fired — both are zero-cost.
 */
adminAi.post('/api/admin/traces/:traceId/explain', async (c) => {
  const { orgId } = need(c);
  const traceId = c.req.param('traceId');
  const row = await c.env.DB.prepare(
    `SELECT id, trace_kind, endpoint_slug, model, status, prompt_template, input_json,
            output_text, error_message, latency_ms, tokens_input, tokens_output, created_at,
            explanation
     FROM ai_form_logs WHERE id = ? AND org_id = ? LIMIT 1`,
  )
    .bind(traceId, orgId)
    .first<AiTraceRow & { explanation: string | null }>();
  if (!row) throw new HTTPError(404, 'Trace not found');

  // ── L1 cache hit: D1 column (free re-explain even after KV eviction). ──
  if (row.explanation && row.explanation.trim().length > 0) {
    c.executionCtx.waitUntil(
      auditService.writeAuditLog(c.env.DB, {
        org_id: orgId,
        actor_id: c.get('userId') ?? null,
        action: 'admin.trace_explained',
        message: `Trace ${traceId} explanation served from D1 cache (zero-cost)`,
        target_type: 'ai_trace',
        target_id: traceId,
        metadata_json: { source: 'd1_column', cached: true },
        request_id: c.get('requestId'),
      }),
    );
    return c.json({
      data: {
        markdown: row.explanation,
        model: '@cf/meta/llama-3.1-8b-instruct-fp8',
        cached: true,
      },
    });
  }

  // ── Cold path (or KV-only cache hit, handled inside explainTrace). ──
  const out = await explainTrace(c.env, row);

  // Persist to D1 if this was a fresh generation so the next call hits L1.
  if (!out.cached && out.markdown && !out.markdown.startsWith('AI explanation unavailable')) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE ai_form_logs SET explanation = ? WHERE id = ? AND org_id = ?')
        .bind(out.markdown, traceId, orgId)
        .run()
        .catch(() => undefined)
        .then(() => undefined),
    );
  }

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'admin.trace_explained',
      message: out.cached
        ? `Trace ${traceId} explanation served from KV cache`
        : `Trace ${traceId} explanation generated via AI Gateway (${out.model})`,
      target_type: 'ai_trace',
      target_id: traceId,
      metadata_json: { source: out.cached ? 'kv' : 'ai_gateway', model: out.model },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: out });
});

/* ────────────────────────── #94 AI Natural-Language Search ────────────────────────── */

/**
 * POST /api/admin/search/ai
 *
 * Body: { query: string }. Asks the LLM to pick an entity + filter, runs a
 * parameterised D1 SELECT (org-scoped), returns rows + the LLM's structured
 * filter for transparency.
 */
adminAi.post('/api/admin/search/ai', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as { query?: string };
  const query = (body.query ?? '').trim();
  if (query.length < 2) throw new HTTPError(400, 'query must be at least 2 characters');
  try {
    const out = await aiSearch(c.env, orgId, query);
    return c.json({ data: out });
  } catch (err) {
    throw new HTTPError(502, err instanceof Error ? err.message : 'AI search failed');
  }
});

/* ────────────────────────── Cmd-K Inline AI Streaming ────────────────────────── */

/**
 * POST /api/admin/ai/stream/palette
 *
 * Inline-streaming companion to the Cmd-K command palette. The palette stays
 * open while tokens arrive, so the user keeps both navigation matches AND the
 * AI answer in view. Backed by Workers AI Llama 3.3 70B (auto-routed through
 * AI Gateway via `env.AI.run`).
 *
 * **Protocol** — Server-Sent Events. The body is `text/event-stream` and
 * frames are newline-delimited JSON payloads:
 *
 * | Frame                                      | Meaning                       |
 * | ------------------------------------------ | ----------------------------- |
 * | `data: {"chunk":"…"}\n\n`                  | Append a token to the UI pane |
 * | `data: {"done":true,"model":"…","ms":N}\n\n` | Stream complete             |
 * | `data: {"error":{"code":"…","message":"…"}}\n\n` | Fatal — UI shows fallback |
 *
 * **Rate limiting** — per-org soft cap of 30 streams / 5 min, enforced via
 * `CACHE_KV` counter. Bursts get a 429 with an explanatory chunk so the UI
 * can render the message inline (better than a silent close).
 *
 * **Cancellation** — when the client aborts (`AbortController.abort()` on the
 * fetch), the underlying `ReadableStream` from Workers AI is released and
 * the writer is closed. No leaked CPU time charged to the worker budget.
 *
 * **Fallback** — when `env.AI.run` errors (model 5xx, gateway down), the
 * stream emits a single `error` frame and a friendly chunk so the palette
 * can still render something useful (and offer "Open full chat" as escape).
 *
 * **Audit** — fire-and-forget `cmdk.ai.answered` entry containing the first
 * 40 chars of the query slice; never persists the full streamed answer.
 *
 * Body: `{ query: string, context?: { selected_site_id?: string, current_route?: string } }`.
 */
adminAi.post('/api/admin/ai/stream/palette', async (c) => {
  const { orgId, userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    query?: string;
    context?: { selected_site_id?: string; current_route?: string };
  };
  const query = (body.query ?? '').trim();
  if (query.length < 2) throw new HTTPError(400, 'query must be at least 2 characters');
  if (query.length > 1500) throw new HTTPError(413, 'query must be ≤ 1500 characters');

  // Per-org soft rate limit: 30 streams / 5min via CACHE_KV counter.
  const rateKey = `cmdk_ai_rate:${orgId}`;
  const rateRaw = await c.env.CACHE_KV.get(rateKey);
  const rateCount = rateRaw ? parseInt(rateRaw, 10) || 0 : 0;
  if (rateCount >= 30) {
    throw new HTTPError(429, 'AI palette rate limit reached. Try again in a few minutes.');
  }
  // Fire-and-forget bump; 300s TTL gives a rolling 5-min window.
  c.executionCtx.waitUntil(
    c.env.CACHE_KV.put(rateKey, String(rateCount + 1), { expirationTtl: 300 }),
  );

  const ctxSite = body.context?.selected_site_id
    ? `Selected site id: ${body.context.selected_site_id}.`
    : '';
  const ctxRoute = body.context?.current_route
    ? `Current admin route: ${body.context.current_route}.`
    : '';
  const systemPrompt = [
    "You are the AI assistant inside the Project Sites admin dashboard's command palette.",
    'Answer concisely (≤4 sentences).',
    'When the user asks how to do something in the dashboard, suggest the specific admin route (e.g. /admin/forms, /admin/snapshots, /admin/billing, /admin/audit) AND offer to navigate them there in your response.',
    ctxSite,
    ctxRoute,
  ]
    .filter(Boolean)
    .join(' ');

  const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const started = Date.now();

  // Audit log: fire-and-forget, never blocks the stream.
  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'cmdk.ai.answered',
      message: `Cmd-K AI answered: '${query.slice(0, 40)}'`,
      target_type: 'cmdk_ai',
      metadata_json: {
        query_length: query.length,
        model,
        selected_site_id: body.context?.selected_site_id ?? null,
        current_route: body.context?.current_route ?? null,
      },
      request_id: c.get('requestId'),
    }),
  );

  const encoder = new TextEncoder();
  const writeFrame = (
    writer: WritableStreamDefaultWriter<Uint8Array>,
    payload: unknown,
  ): Promise<void> => writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  // Drive the LLM in the background; the response returns immediately so
  // Hono ships the headers + opens the stream to the client.
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const upstream = (await c.env.AI.run(
          model as Parameters<typeof c.env.AI.run>[0],
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: query },
            ],
            stream: true,
            max_tokens: 512,
          } as Parameters<typeof c.env.AI.run>[1],
        )) as ReadableStream<Uint8Array>;

        // Workers AI streams SSE-formatted Uint8Array chunks: `data: {"response":"…"}\n\n`.
        // Re-frame each token as a clean `{"chunk":"…"}` envelope so the UI never
        // has to know the upstream wire format.
        const reader = upstream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data:')) continue;
            const json = line.slice(5).trim();
            if (!json || json === '[DONE]') continue;
            try {
              const parsed = JSON.parse(json) as { response?: string };
              const token = parsed.response ?? '';
              if (token) await writeFrame(writer, { chunk: token });
            } catch {
              // Non-JSON keep-alive or padding — skip silently.
            }
          }
        }
        await writeFrame(writer, { done: true, model, ms: Date.now() - started });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'AI is offline right now';
        // Fallback chunk + structured error frame so the UI can render BOTH
        // the friendly sentence inline AND know to show the "Open full chat"
        // escape hatch.
        try {
          await writeFrame(writer, {
            chunk:
              'Sorry — the AI service is unavailable right now. Try the full chat for a retry.',
          });
          await writeFrame(writer, { error: { code: 'AI_UNAVAILABLE', message: msg } });
        } catch {
          /* writer already closed by client abort — nothing to do */
        }
      } finally {
        try {
          await writer.close();
        } catch {
          /* already closed */
        }
      }
    })(),
  );

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

/* ────────────────────────── AI Chat Widget (SSE + Tool Use) ────────────────────────── */

/**
 * POST /api/admin/ai/stream/chat
 *
 * Server-Sent Events backing the floating `<app-ai-chat-widget>` admin assistant
 * (the right-rail side panel). The widget keeps a local conversation log
 * (`AiChatService.messages()`) and round-trips a sliding window of recent
 * messages back to this handler with each turn. The handler streams tokens
 * back as `{chunk}` frames, recognises in-line `<tool>{…}</tool>` envelopes
 * the model emits, decodes them, and re-frames each one as a `{tool}` event
 * so the UI can render a confirmation card before the action fires.
 *
 * **Protocol** — Server-Sent Events. Body is `text/event-stream` and frames
 * are newline-delimited JSON payloads:
 *
 * | Frame                                            | Meaning                            |
 * | ------------------------------------------------ | ---------------------------------- |
 * | `data: {"chunk":"…"}\n\n`                        | Append a token to the visible body |
 * | `data: {"tool":{"name":"…","args":{…}}}\n\n`     | Render a tool-confirmation card    |
 * | `data: {"done":true,"model":"…","ms":N}\n\n`     | Stream complete                    |
 * | `data: {"error":{"code":"…","message":"…"}}\n\n` | Fatal — UI surfaces a toast        |
 *
 * **Tool surface** — the system prompt enumerates exactly three callable
 * tools the assistant may emit, each as a `<tool>{"name":"…","args":{…}}</tool>`
 * envelope dropped mid-completion:
 *
 *   - `navigate({ to: string })`             — push a router URL
 *   - `set_theme({ theme: 'dark'|'light' })` — flip `<html data-theme>`
 *   - `open_help_topic({ topic: string })`   — open the shortcuts overlay
 *
 * The model is instructed NEVER to call a tool without first explaining why,
 * and the UI ALWAYS shows a Run/Dismiss card — never auto-executes.
 *
 * **Audit** — fire-and-forget `chat.ai.message` per user turn and
 * `chat.ai.tool_call` per emitted tool envelope. Tool execution itself is
 * audited client-side via the standard admin-action audit pipeline.
 *
 * Body: `{ conversation: { role: 'user'|'assistant', content: string }[],
 *          context: { selected_site_id?: string|null, current_route?: string|null } }`.
 */
/**
 * Editor tool surface. When `context.surface === 'editor'`, the system prompt
 * is augmented with these six tools and the model emits `<tool_call>` envelopes
 * (paired with `<tool_result>` posted back by the client). Provider-neutral on
 * the wire — the bolt.diy chat client owns dispatch via `~/lib/tools/dispatcher`.
 */
const EDITOR_TOOL_SURFACE: { name: string; description: string }[] = [
  {
    name: 'openFile',
    description:
      'openFile({"path":"src/App.tsx"}) — opens the file in the editor and returns its contents + language + line_count.',
  },
  {
    name: 'jumpToLine',
    description:
      'jumpToLine({"path":"src/App.tsx","line":42,"column":4}) — scrolls the editor to a coordinate. 1-based line/column.',
  },
  {
    name: 'runCommand',
    description:
      'runCommand({"command":"npm test","cwd":"."}) — runs in the WebContainer terminal. Output truncated at 8KB.',
  },
  {
    name: 'search',
    description:
      'search({"query":"useEffect","regex":false,"file_pattern":"src/**/*.tsx"}) — grep across the workbench, up to 50 hits.',
  },
  {
    name: 'getSelection',
    description: 'getSelection({}) — returns the active editor selection {path,text,from,to}.',
  },
  {
    name: 'replaceSelection',
    description:
      'replaceSelection({"text":"…"}) — replaces the active selection. Always run getSelection first.',
  },
];

/**
 * `POST /api/admin/ai/stream/chat` — Streaming dashboard AI chat over SSE.
 *
 * @remarks
 * Body: `{ messages: Array<{role, content}>, site_id? }`. Returns a
 * `text/event-stream` of chunked tokens from Workers AI Llama 3.3 70B
 * with {@link DASHBOARD_PERSONA_SYSTEM_PROMPT} system message. Site
 * context (research, AI logs) is injected when `site_id` is supplied.
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 */
adminAi.post('/api/admin/ai/stream/chat', async (c) => {
  const { orgId, userId } = need(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    conversation?: { role?: string; content?: string }[];
    context?: {
      selected_site_id?: string | null;
      current_route?: string | null;
      surface?: 'admin' | 'editor';
    };
  };

  const turns = Array.isArray(body.conversation) ? body.conversation : [];
  if (turns.length === 0)
    throw new HTTPError(400, 'conversation must contain at least one message');
  if (turns.length > 24) throw new HTTPError(413, 'conversation must be ≤ 24 messages');

  const cleaned: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of turns) {
    if (typeof t?.content !== 'string') continue;
    if (t.role !== 'user' && t.role !== 'assistant') continue;
    const content = t.content.trim();
    if (!content) continue;
    if (content.length > 4000) throw new HTTPError(413, 'each message must be ≤ 4000 characters');
    cleaned.push({ role: t.role, content });
  }
  if (cleaned.length === 0) throw new HTTPError(400, 'no valid messages in conversation');

  const lastUser = [...cleaned].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new HTTPError(400, 'conversation must end with a user message');

  // Per-org soft rate limit: 60 chat streams / 5min via CACHE_KV counter.
  const rateKey = `aichat_rate:${orgId}`;
  const rateRaw = await c.env.CACHE_KV.get(rateKey);
  const rateCount = rateRaw ? parseInt(rateRaw, 10) || 0 : 0;
  if (rateCount >= 60) {
    throw new HTTPError(429, 'AI chat rate limit reached. Try again in a few minutes.');
  }
  c.executionCtx.waitUntil(
    c.env.CACHE_KV.put(rateKey, String(rateCount + 1), { expirationTtl: 300 }),
  );

  const selectedSite = body.context?.selected_site_id ?? null;
  const currentRoute = body.context?.current_route ?? null;
  const surface = body.context?.surface === 'editor' ? 'editor' : 'admin';

  const editorToolLines =
    surface === 'editor'
      ? [
          '',
          'EDITOR TOOLS — these execute IMMEDIATELY (no confirmation card). Use them to drive the editor.',
          'Emit EXACTLY this envelope with a unique id: <tool_call name="<name>" id="<unique_id>">{"args":{…}}</tool_call>. The client will reply with <tool_result id="<unique_id>">…</tool_result>.',
          ...EDITOR_TOOL_SURFACE.map((t) => `  - ${t.description}`),
          'Workflow: explain in 1 sentence WHY you are running the tool, emit the envelope, wait for the tool_result, then continue. You may chain calls but never emit two tool_calls in one message.',
        ]
      : [];

  const systemPrompt = [
    surface === 'editor'
      ? 'You are the AI assistant embedded in the bolt.diy editor. You can read files, run commands, jump around the editor, and replace selections. Answer concisely.'
      : 'You are the AI assistant inside the Project Sites admin dashboard. Answer concisely (≤6 sentences unless asked for more).',
    'You can call dashboard tools by emitting EXACTLY this XML-style envelope inline in your response: <tool>{"name":"<tool_name>","args":{…}}</tool>. The user will see a confirmation card before any dashboard tool fires — never auto-execute.',
    'Available dashboard tools:',
    '  - navigate({"to": "/admin/<route>"}) — push a router URL. Examples: /admin/forms, /admin/snapshots, /admin/billing, /admin/audit.',
    '  - set_theme({"theme": "dark" | "light"}) — flip the dashboard color scheme.',
    '  - open_help_topic({"topic": "<slug>"}) — open the shortcuts overlay or docs anchor.',
    'Always explain WHY you are suggesting a dashboard tool BEFORE emitting the envelope. Emit at most one dashboard tool per response.',
    ...editorToolLines,
    selectedSite ? `Selected site id: ${selectedSite}.` : 'No site is selected.',
    currentRoute ? `Current admin route: ${currentRoute}.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const started = Date.now();

  // Audit log: fire-and-forget, never blocks the stream.
  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId,
      action: 'chat.ai.message',
      message: `AI chat user message: '${lastUser.content.slice(0, 60)}'`,
      target_type: 'ai_chat',
      metadata_json: {
        model,
        turns: cleaned.length,
        message_length: lastUser.content.length,
        selected_site_id: selectedSite,
        current_route: currentRoute,
        surface,
      },
      request_id: c.get('requestId'),
    }),
  );

  const encoder = new TextEncoder();
  const writeFrame = (
    writer: WritableStreamDefaultWriter<Uint8Array>,
    payload: unknown,
  ): Promise<void> => writer.write(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  // Regex to extract a balanced `<tool>{…}</tool>` envelope from the streamed
  // text buffer. Captures the JSON body so we can parse + audit + re-frame.
  const TOOL_RE = /<tool>\s*(\{[\s\S]*?\})\s*<\/tool>/g;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const upstream = (await c.env.AI.run(
          model as Parameters<typeof c.env.AI.run>[0],
          {
            messages: [{ role: 'system', content: systemPrompt }, ...cleaned],
            stream: true,
            max_tokens: 1024,
          } as Parameters<typeof c.env.AI.run>[1],
        )) as ReadableStream<Uint8Array>;

        const reader = upstream.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = '';
        // Rolling buffer of fully-emitted assistant text so we can scan it for
        // complete `<tool>…</tool>` envelopes across chunk boundaries.
        let assembled = '';
        let nextToolScanFrom = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';

          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data:')) continue;
            const json = line.slice(5).trim();
            if (!json || json === '[DONE]') continue;
            try {
              const parsed = JSON.parse(json) as { response?: string };
              const token = parsed.response ?? '';
              if (!token) continue;
              assembled += token;
              await writeFrame(writer, { chunk: token });

              // Scan the new region for any completed tool envelopes.
              TOOL_RE.lastIndex = nextToolScanFrom;
              let match: RegExpExecArray | null;
              while ((match = TOOL_RE.exec(assembled)) !== null) {
                const envelope = match[1];
                if (!envelope) continue;
                try {
                  const tool = JSON.parse(envelope) as {
                    name?: string;
                    args?: Record<string, unknown>;
                  };
                  const allowed = ['navigate', 'set_theme', 'open_help_topic'];
                  if (tool.name && allowed.includes(tool.name)) {
                    // Coerce arg values to strings (the UI handlers expect strings).
                    const args: Record<string, string> = {};
                    for (const [k, v] of Object.entries(tool.args ?? {})) {
                      args[k] = String(v ?? '');
                    }
                    await writeFrame(writer, { tool: { name: tool.name, args } });

                    // Audit tool emissions (fire-and-forget).
                    c.executionCtx.waitUntil(
                      auditService.writeAuditLog(c.env.DB, {
                        org_id: orgId,
                        actor_id: userId,
                        action: 'chat.ai.tool_call',
                        message: `AI proposed tool '${tool.name}'`,
                        target_type: 'ai_chat_tool',
                        metadata_json: { tool: tool.name, args },
                        request_id: c.get('requestId'),
                      }),
                    );
                  }
                } catch {
                  /* malformed tool envelope — skip silently. */
                }
                nextToolScanFrom = TOOL_RE.lastIndex;
              }
            } catch {
              // Non-JSON keep-alive / padding — skip silently.
            }
          }
        }
        await writeFrame(writer, { done: true, model, ms: Date.now() - started });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'AI is offline right now';
        try {
          await writeFrame(writer, {
            chunk: 'Sorry — the AI service is unavailable right now. Try again in a moment.',
          });
          await writeFrame(writer, { error: { code: 'AI_UNAVAILABLE', message: msg } });
        } catch {
          /* writer already closed by client abort */
        }
      } finally {
        try {
          await writer.close();
        } catch {
          /* already closed */
        }
      }
    })(),
  );

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
