/**
 * @module durable_objects/voice_browse_agent
 *
 * @description
 * `VoiceBrowseAgent` — Cloudflare Container Durable Object hosting a headless
 * Playwright (Chromium) instance for the Voice AI.
 *
 * When the Voice AI is mid-call and the caller asks something that requires
 * real-time web action ("what's the weather in 60201", "fill out the lead
 * form on competitor.com"), the AI's tool dispatcher routes to this DO.
 *
 * Responsibilities:
 *  - Spin up Playwright and record every step as MP4 (1280x720).
 *  - Stream letter-by-letter narration over SSE so the parent worker can pipe
 *    it into the live voice synthesis stream.
 *  - On `/stop`, finalize MP4, upload to R2 at `voice/{siteId}/{callId}/browse.mp4`,
 *    and call back into the parent worker so the conversation timeline gets
 *    the video reference next to the audio recording.
 *  - Agentic loop: Workers AI Llama 3.3 70B chooses next tool from
 *    {goto, click, type, extract, screenshot, wait}; 8-step cap; PII-sanitised
 *    narrations on every step.
 *
 * Mirrors `app_runtime.ts` patterns:
 *  - `sleepAfter = '30m'` idle hibernation.
 *  - 1000-line SQLite ring buffer for forensic narration log.
 *  - 3-per-rolling-minute restart cap inside `onError`.
 *  - `enableInternet = true` (Playwright needs egress).
 *
 * @packageDocumentation
 */

import { Container } from '@cloudflare/containers';
import type { Env } from '../types/env.js';
import {
  chunkNarration,
  dispatchAction,
  narrateAction,
  RESTART_WINDOW_MS,
  sanitisePII,
  shouldRestart,
  type BrowseAction,
} from './voice_browse_helpers.js';

// Re-export the public pure helpers + types so existing callers keep working.
export {
  chunkNarration,
  dispatchAction,
  narrateAction,
  sanitisePII,
  shouldRestart,
  type BrowseAction,
} from './voice_browse_helpers.js';

// ── Types ───────────────────────────────────────────────────────────────────

/** Call lifecycle states. */
export type CallStatus = 'starting' | 'running' | 'completed' | 'failed' | 'refused';

/** Body for `POST /start`. */
export interface StartBody {
  readonly call_id: string;
  readonly query: string;
  readonly voice_id?: string;
  /** Default true. When false, narration log is still kept but not streamed. */
  readonly narrate?: boolean;
  /** From `voice_agent_settings.video_browse_enabled`; default true. */
  readonly video_browse_enabled?: boolean;
  /** R2 path prefix root — defaults to `voice/${site_id}/${call_id}/`. */
  readonly site_id?: string;
}

/** Body for `POST /step`. */
export interface StepBody {
  readonly call_id: string;
  readonly action: BrowseAction;
}

/** Response shape of `POST /step`. */
export interface StepResult {
  readonly ok: boolean;
  readonly observation: string;
  readonly screenshot_url?: string;
  readonly narration: string;
}

/** Narration log entry persisted in SQLite. */
interface NarrationEntry {
  readonly ts: number;
  readonly kind: 'system' | 'action' | 'observation' | 'final' | 'refused';
  readonly text: string;
}

/** SQLite call-row shape (one per call_id). */
interface CallRow {
  call_id: string;
  started_at: number;
  ended_at: number | null;
  status: string;
  narration_log: string;
  screenshots: string;
  video_local_path: string | null;
  video_r2_key: string | null;
  restart_count: number;
  [key: string]: SqlStorageValue;
}

// ── Constants ───────────────────────────────────────────────────────────────

const LOG_RING_LIMIT = 1000;
const MAX_AGENTIC_STEPS = 8;
const SSE_HEARTBEAT_MS = 15_000;

/**
 * Inline schema. Calls table is the canonical record per browse session;
 * narration_log/screenshots are JSON arrays; restart_window enforces the
 * 3/min cap used by `onError`.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS calls (
  call_id          TEXT PRIMARY KEY,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  status           TEXT    NOT NULL,
  narration_log    TEXT    NOT NULL DEFAULT '[]',
  screenshots      TEXT    NOT NULL DEFAULT '[]',
  video_local_path TEXT,
  video_r2_key     TEXT,
  restart_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);

CREATE TABLE IF NOT EXISTS restart_window (
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_restart_ts ON restart_window(ts DESC);
`;

// ── Durable Object class ────────────────────────────────────────────────────

/**
 * Voice-AI-driven browser agent. One DO instance per concurrent voice call.
 *
 * @example
 * ```ts
 * const id = env.VOICE_BROWSE_AGENT.idFromName(callId);
 * const stub = env.VOICE_BROWSE_AGENT.get(id);
 * await stub.fetch(new Request('https://do/start', {
 *   method: 'POST',
 *   body: JSON.stringify({ call_id, query: 'weather in 60201', site_id }),
 * }));
 * ```
 */
export class VoiceBrowseAgent extends Container<Env> {
  /** Container internal port — entry.mjs wires Playwright + bridge here. */
  defaultPort = 9223;

  /** Hibernate after 30 min idle. */
  override sleepAfter = '30m';

  /** Playwright needs outbound egress. */
  override enableInternet = true;

  private schemaReady = false;
  private narrationSubscribers = new Map<string, Set<WritableStreamDefaultWriter<Uint8Array>>>();

  // ── Schema + storage helpers ──────────────────────────────────────────

  private get vbSql(): SqlStorage | null {
    const candidate = (this.ctx.storage as { sql?: SqlStorage }).sql;
    return candidate ?? null;
  }

  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.vbSql?.exec(SCHEMA_SQL);
    this.schemaReady = true;
  }

  private getCall(callId: string): CallRow | null {
    if (!this.vbSql) return null;
    const row = this.vbSql
      .exec<CallRow>('SELECT * FROM calls WHERE call_id = ?', callId)
      .toArray()[0];
    return row ?? null;
  }

  private upsertCall(row: Partial<CallRow> & { call_id: string }): void {
    if (!this.vbSql) return;
    const existing = this.getCall(row.call_id);
    if (existing) {
      const merged = { ...existing, ...row };
      this.vbSql.exec(
        `UPDATE calls SET
           ended_at = ?, status = ?, narration_log = ?, screenshots = ?,
           video_local_path = ?, video_r2_key = ?, restart_count = ?
         WHERE call_id = ?`,
        merged.ended_at,
        merged.status,
        merged.narration_log,
        merged.screenshots,
        merged.video_local_path,
        merged.video_r2_key,
        merged.restart_count,
        merged.call_id,
      );
    } else {
      this.vbSql.exec(
        `INSERT INTO calls
           (call_id, started_at, ended_at, status, narration_log, screenshots,
            video_local_path, video_r2_key, restart_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.call_id,
        row.started_at ?? Date.now(),
        row.ended_at ?? null,
        row.status ?? 'starting',
        row.narration_log ?? '[]',
        row.screenshots ?? '[]',
        row.video_local_path ?? null,
        row.video_r2_key ?? null,
        row.restart_count ?? 0,
      );
    }
  }

  private appendNarration(callId: string, entry: NarrationEntry): void {
    if (!this.vbSql) return;
    const row = this.getCall(callId);
    if (!row) return;
    const log: NarrationEntry[] = JSON.parse(row.narration_log) as NarrationEntry[];
    log.push(entry);
    while (log.length > LOG_RING_LIMIT) log.shift();
    this.vbSql.exec(
      'UPDATE calls SET narration_log = ? WHERE call_id = ?',
      JSON.stringify(log),
      callId,
    );
    this.fanoutNarration(callId, entry);
  }

  private fanoutNarration(callId: string, entry: NarrationEntry): void {
    const subs = this.narrationSubscribers.get(callId);
    if (!subs || subs.size === 0) return;
    const enc = new TextEncoder();
    for (const chunk of chunkNarration(entry.text)) {
      const payload = `data: ${JSON.stringify({ ...entry, text: chunk })}\n\n`;
      const bytes = enc.encode(payload);
      for (const w of subs) {
        w.write(bytes).catch(() => subs.delete(w));
      }
    }
  }

  // ── Restart cap (3/min) ──────────────────────────────────────────────

  private restartHistory(): number[] {
    if (!this.vbSql) return [];
    return this.vbSql
      .exec<{ ts: number; [k: string]: SqlStorageValue }>(
        'SELECT ts FROM restart_window ORDER BY ts DESC LIMIT 100',
      )
      .toArray()
      .map((r) => r.ts);
  }

  private recordRestart(now: number): void {
    if (!this.vbSql) return;
    this.vbSql.exec('INSERT INTO restart_window (ts) VALUES (?)', now);
    this.vbSql.exec('DELETE FROM restart_window WHERE ts < ?', now - RESTART_WINDOW_MS);
  }

  // ── Container bridge ─────────────────────────────────────────────────

  /**
   * Forward an action to the in-container Playwright bridge listening on
   * `defaultPort`. Lazy-starts the container on first call.
   */
  private async containerCall(path: string, body: unknown): Promise<Response> {
    if (!this.alreadyRunning) {
      await this.startAndWaitForPorts([this.defaultPort], {
        portReadyTimeoutMS: 60_000,
      });
      this.alreadyRunning = true;
    }
    const innerUrl = new URL(path, `http://container.local:${this.defaultPort}`);
    const req = new Request(innerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.containerFetch(req, this.defaultPort);
  }

  private alreadyRunning = false;

  // ── Route handlers ───────────────────────────────────────────────────

  private async handleStart(body: StartBody): Promise<Response> {
    this.ensureSchema();
    const { call_id, query, video_browse_enabled = true, site_id = 'unknown' } = body;
    if (!call_id || !query) {
      return Response.json({ error: 'call_id + query required' }, { status: 400 });
    }

    // Honour video_browse_enabled=false from voice_agent_settings — refuse cleanly.
    if (!video_browse_enabled) {
      this.upsertCall({
        call_id,
        started_at: Date.now(),
        ended_at: Date.now(),
        status: 'refused',
      });
      this.appendNarration(call_id, {
        ts: Date.now(),
        kind: 'refused',
        text: 'Video browse is disabled for this voice agent.',
      });
      return Response.json({ ok: false, reason: 'video_browse_disabled' }, { status: 200 });
    }

    // Idempotent: if call_id already running, just resume.
    const existing = this.getCall(call_id);
    if (existing && existing.status === 'running') {
      return Response.json({ ok: true, resumed: true, call_id });
    }
    this.upsertCall({
      call_id,
      started_at: existing?.started_at ?? Date.now(),
      ended_at: null,
      status: 'running',
    });

    this.appendNarration(call_id, {
      ts: Date.now(),
      kind: 'system',
      text: sanitisePII(`Starting browse for "${query}". One moment.`),
    });

    // Audit-log the start through the parent worker /internal endpoint.
    this.ctx.waitUntil(
      this.notifyInternal('/internal/voice/browse-started', {
        call_id,
        site_id,
        query: sanitisePII(query),
      }),
    );

    // Fire and forget: kick off the agentic loop in waitUntil so the HTTP
    // response returns immediately with the SSE narration URL.
    this.ctx.waitUntil(this.solveQuery(call_id, query, site_id));

    return Response.json({
      ok: true,
      call_id,
      narration_stream: `/narration?call_id=${encodeURIComponent(call_id)}`,
    });
  }

  private async handleStep(body: StepBody): Promise<Response> {
    this.ensureSchema();
    const { call_id, action } = body;
    if (!call_id) {
      return Response.json({ error: 'call_id required' }, { status: 400 });
    }
    let parsed: BrowseAction;
    try {
      parsed = dispatchAction(action);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, observation: msg, narration: '' }, { status: 400 });
    }

    const narrationText = sanitisePII(narrateAction(parsed));
    this.appendNarration(call_id, {
      ts: Date.now(),
      kind: 'action',
      text: narrationText,
    });

    let res: Response;
    try {
      res = await this.containerCall('/playwright/step', { call_id, action: parsed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.appendNarration(call_id, { ts: Date.now(), kind: 'observation', text: `Step failed: ${msg}` });
      return Response.json({ ok: false, observation: msg, narration: narrationText }, { status: 502 });
    }

    const data = (await res.json()) as { observation?: string; screenshot_url?: string };
    const observation = sanitisePII(data.observation ?? '');
    this.appendNarration(call_id, { ts: Date.now(), kind: 'observation', text: observation });

    // Audit-log every action.
    this.ctx.waitUntil(
      this.notifyInternal('/internal/voice/browse-action', {
        call_id,
        action: parsed,
        observation,
      }),
    );

    const result: StepResult = {
      ok: true,
      observation,
      screenshot_url: data.screenshot_url,
      narration: narrationText,
    };
    return Response.json(result);
  }

  private handleNarrationStream(callId: string): Response {
    if (!callId) {
      return new Response('call_id required', { status: 400 });
    }
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    let subs = this.narrationSubscribers.get(callId);
    if (!subs) {
      subs = new Set();
      this.narrationSubscribers.set(callId, subs);
    }
    subs.add(writer);

    // Replay backlog so the client has context.
    const row = this.getCall(callId);
    if (row) {
      const log = JSON.parse(row.narration_log) as NarrationEntry[];
      const init = log
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join('');
      if (init) writer.write(new TextEncoder().encode(init)).catch(() => undefined);
    }

    const heartbeat = setInterval(() => {
      writer.write(new TextEncoder().encode(': keepalive\n\n')).catch(() => {
        clearInterval(heartbeat);
        subs?.delete(writer);
      });
    }, SSE_HEARTBEAT_MS);

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  private async handleStop(body: { call_id: string; site_id?: string }): Promise<Response> {
    this.ensureSchema();
    const { call_id, site_id = 'unknown' } = body;
    if (!call_id) return Response.json({ error: 'call_id required' }, { status: 400 });
    const row = this.getCall(call_id);
    if (!row) return Response.json({ error: 'call not found' }, { status: 404 });

    // Tell the container to stop recording + flush the MP4.
    let localPath = '';
    let durationMs = 0;
    try {
      const res = await this.containerCall('/playwright/stop', { call_id });
      const data = (await res.json()) as { video_local_path: string; duration_ms: number };
      localPath = data.video_local_path;
      durationMs = data.duration_ms;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.appendNarration(call_id, { ts: Date.now(), kind: 'system', text: `Stop failed: ${msg}` });
    }

    // Pull the MP4 from the container and stream into R2.
    const videoR2Key = `voice/${site_id}/${call_id}/browse.mp4`;
    if (localPath) {
      try {
        const fileRes = await this.containerCall('/playwright/video', { call_id });
        if (fileRes.ok && fileRes.body) {
          await this.env.SITES_BUCKET.put(videoR2Key, fileRes.body, {
            httpMetadata: { contentType: 'video/mp4' },
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.appendNarration(call_id, {
          ts: Date.now(),
          kind: 'system',
          text: `Video upload failed: ${msg}`,
        });
      }
    }

    this.upsertCall({
      call_id,
      ended_at: Date.now(),
      status: 'completed',
      video_local_path: localPath || null,
      video_r2_key: videoR2Key,
    });

    // Notify parent worker so the conversation timeline gets the video ref.
    this.ctx.waitUntil(
      this.notifyInternal('/internal/voice/recording-saved', {
        call_id,
        site_id,
        video_r2_key: videoR2Key,
        duration_ms: durationMs,
      }),
    );

    return Response.json({ ok: true, video_r2_key: videoR2Key, duration_ms: durationMs });
  }

  // ── Agentic loop ─────────────────────────────────────────────────────

  /**
   * Drive the browser autonomously until the LLM emits a `final` step OR
   * the 8-step cap is hit. Each step:
   *   1. Take a screenshot + DOM summary.
   *   2. Ask Llama 3.3 70B for the next tool call.
   *   3. Execute via the in-container Playwright bridge.
   *   4. Narrate progress (sanitised) into the SSE stream.
   */
  private async solveQuery(callId: string, query: string, siteId: string): Promise<void> {
    for (let step = 0; step < MAX_AGENTIC_STEPS; step++) {
      let domSummary = '';
      try {
        const obsRes = await this.containerCall('/playwright/observe', { call_id: callId });
        const obs = (await obsRes.json()) as { dom_summary?: string };
        domSummary = obs.dom_summary ?? '';
      } catch {
        // No observation; LLM falls back to "open google".
      }

      const tool = await this.pickNextTool(query, domSummary, step);
      if (tool === null) {
        // LLM signalled completion.
        this.appendNarration(callId, {
          ts: Date.now(),
          kind: 'final',
          text: sanitisePII(`Done with "${query}".`),
        });
        return;
      }
      await this.handleStep({ call_id: callId, action: tool }).catch(() => undefined);
    }
    this.appendNarration(callId, {
      ts: Date.now(),
      kind: 'final',
      text: 'Reached step cap; ending browse.',
    });
    // Caller is expected to /stop and finalise the MP4.
    void siteId;
  }

  /**
   * Ask Workers AI Llama 3.3 70B for the next browse action. Returns null
   * when the model decides the task is complete.
   */
  private async pickNextTool(
    query: string,
    domSummary: string,
    step: number,
  ): Promise<BrowseAction | null> {
    const prompt = [
      `You are a browsing assistant. Goal: ${sanitisePII(query)}`,
      `Step ${step + 1}/${MAX_AGENTIC_STEPS}.`,
      `Current DOM summary:\n${domSummary.slice(0, 2000)}`,
      `Reply with a JSON object: {"action": {...}} where action is one of`,
      `{type:'goto',url}|{type:'click',selector}|{type:'type',selector,text}|`,
      `{type:'extract',selector}|{type:'screenshot'}|{type:'wait',ms} OR {"done":true}.`,
    ].join('\n');

    try {
      const aiArgs = {
        messages: [{ role: 'user' as const, content: prompt }],
      };
      const out = (await this.env.AI.run(
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        // Workers AI input types are over-narrow for the messages variant.
        aiArgs as unknown as Ai_Cf_Meta_Llama_3_3_70B_Instruct_Fp8_Fast_Input,
      )) as { response?: string };
      const text = (out.response ?? '').trim();
      const jsonStart = text.indexOf('{');
      if (jsonStart < 0) return { type: 'goto', url: `https://www.google.com/search?q=${encodeURIComponent(query)}` };
      const parsed = JSON.parse(text.slice(jsonStart)) as { done?: boolean; action?: unknown };
      if (parsed.done) return null;
      return dispatchAction(parsed.action);
    } catch {
      // Fall back to a Google search on first step, then signal done.
      return step === 0
        ? { type: 'goto', url: `https://www.google.com/search?q=${encodeURIComponent(query)}` }
        : null;
    }
  }

  // ── Internal callback ────────────────────────────────────────────────

  private async notifyInternal(path: string, body: unknown): Promise<void> {
    const base = this.env.INTERNAL_CALLBACK_URL;
    if (!base) return;
    const origin = new URL(base).origin;
    try {
      await fetch(new URL(path, origin), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.env.INTERNAL_BUILD_SECRET
            ? { 'x-internal-secret': this.env.INTERNAL_BUILD_SECRET }
            : {}),
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Non-fatal — admin will surface the audit gap from D1 timeline view.
    }
  }

  // ── HTTP entrypoint ──────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/start') {
        return this.handleStart((await request.json()) as StartBody);
      }
      if (request.method === 'POST' && url.pathname === '/step') {
        return this.handleStep((await request.json()) as StepBody);
      }
      if (request.method === 'GET' && url.pathname === '/narration') {
        return this.handleNarrationStream(url.searchParams.get('call_id') ?? '');
      }
      if (request.method === 'POST' && url.pathname === '/stop') {
        return this.handleStop((await request.json()) as { call_id: string; site_id?: string });
      }
      return new Response('not found', { status: 404 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  // ── Container lifecycle hooks ────────────────────────────────────────

  override onError(error: unknown): unknown {
    this.ensureSchema();
    const now = Date.now();
    const history = this.restartHistory();
    if (!shouldRestart(history, now)) {
      // Cap hit — mark every running call failed and stop trying.
      const failingCalls = this.vbSql
        ?.exec<CallRow>("SELECT call_id FROM calls WHERE status = 'running'")
        .toArray() ?? [];
      for (const row of failingCalls) {
        this.upsertCall({
          call_id: row.call_id,
          status: 'failed',
          ended_at: now,
          restart_count: row.restart_count + 1,
        });
        this.appendNarration(row.call_id, {
          ts: now,
          kind: 'system',
          text: 'Restart cap exceeded — browse aborted.',
        });
      }
      return error;
    }
    this.recordRestart(now);
    this.alreadyRunning = false;
    return error;
  }
}

