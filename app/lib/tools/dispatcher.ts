/**
 * Tool dispatcher (Rec 5 — Phase 4a).
 *
 * Wires the message-parser's `tool_call` event to the actual handlers in
 * {@link ./editor-tools}. Validates args via Zod, times the call, audits
 * via the `PS_TELEMETRY` bridge, surfaces errors via `PS_ERROR`.
 *
 * The dispatcher does NOT touch network or the worker — it returns a
 * serialized string the caller (chat client) frames as a `<tool_result>`
 * envelope and posts back to the model.
 */
import { z } from 'zod';

import { postErrorToParent, postTelemetryToParent } from '~/lib/embed/embedded-mode';
import { createScopedLogger } from '~/utils/logger';

import { getTool, type EditorToolContext } from './editor-tools';

const logger = createScopedLogger('ToolDispatcher');

export interface DispatchOk {
  ok: true;
  name: string;
  id: string;
  result: string;
  durationMs: number;
}

export interface DispatchErr {
  ok: false;
  name: string;
  id: string;
  error: { code: 'unknown_tool' | 'invalid_args' | 'handler_failed'; message: string };
  durationMs: number;
}

export type DispatchResult = DispatchOk | DispatchErr;

/**
 * Run a tool by name. Always resolves (never throws) — failures arrive as
 * `{ok:false, error}` so the caller can frame them as a `tool_result` and
 * let the model self-correct.
 *
 * @param name Tool name (must match an entry in `EDITOR_TOOLS`).
 * @param args Raw JSON args from the `<tool_call>` envelope.
 * @param ctx  Live editor surfaces (browser) or fakes (tests).
 * @param id   Optional correlation id — defaulted to a random one. The model
 *             sets this when it cares about routing multiple in-flight calls.
 */
export async function runTool(
  name: string,
  args: unknown,
  ctx: EditorToolContext,
  id?: string,
): Promise<DispatchResult> {
  const callId = id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t_${Date.now()}`);
  const started = Date.now();

  const tool = getTool(name);
  if (!tool) {
    const ms = Date.now() - started;
    postTelemetryToParent('editor.tool_call', { name, ok: false, ms, error: 'unknown_tool' });
    postErrorToParent({ code: 'editor.tool_unknown', message: `Unknown tool: ${name}` });
    return { ok: false, name, id: callId, error: { code: 'unknown_tool', message: `Unknown tool: ${name}` }, durationMs: ms };
  }

  // Validate args via Zod. Wrap the error in a readable shape so the LLM can
  // self-correct from the message alone.
  const parsed = tool.parameters.safeParse(args ?? {});
  if (!parsed.success) {
    const ms = Date.now() - started;
    const message = parsed.error.issues.map((i: z.ZodIssue) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
    postTelemetryToParent('editor.tool_call', { name, ok: false, ms, error: 'invalid_args' });
    return { ok: false, name, id: callId, error: { code: 'invalid_args', message }, durationMs: ms };
  }

  try {
    const result = await tool.handler(parsed.data, ctx);
    const ms = Date.now() - started;
    postTelemetryToParent('editor.tool_call', { name, ok: true, ms });
    return { ok: true, name, id: callId, result, durationMs: ms };
  } catch (err) {
    const ms = Date.now() - started;
    const message = err instanceof Error ? err.message : 'tool handler threw a non-Error';
    logger.warn(`tool '${name}' failed: ${message}`);
    postTelemetryToParent('editor.tool_call', { name, ok: false, ms, error: 'handler_failed' });
    postErrorToParent({ code: `editor.tool_failed:${name}`, message });
    return { ok: false, name, id: callId, error: { code: 'handler_failed', message }, durationMs: ms };
  }
}

/**
 * Frame a {@link DispatchResult} as the SSE `<tool_result>` envelope the
 * worker streams back to the LLM. JSON body is the tool's serialized
 * result (success) or the error shape (failure).
 */
export function dispatchResultToEnvelope(result: DispatchResult): string {
  const body = result.ok ? result.result : JSON.stringify({ error: result.error });
  return `<tool_result id="${escapeAttr(result.id)}">${body}</tool_result>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
