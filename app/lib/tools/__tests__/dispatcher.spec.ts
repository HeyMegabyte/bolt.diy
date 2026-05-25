/**
 * Dispatcher + tool-registry contract tests (Rec 5 — Phase 4a).
 *
 * The dispatcher must:
 *   - return the file contents when `openFile` succeeds
 *   - surface invalid args via Zod (no handler invocation)
 *   - frame the result as a `<tool_result>` envelope the worker can re-feed to the LLM
 *   - handle handler failures without throwing
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the embed bridge so we don't try to postMessage anywhere.
vi.mock('../../embed/embedded-mode', () => ({
  postErrorToParent: vi.fn(),
  postTelemetryToParent: vi.fn(),
}));

// Mock the language detector — keep the spec independent of Remix module
// resolution. The test only needs a stable string back.
vi.mock('../../../utils/getLanguageFromExtension', () => ({
  getLanguageFromExtension: (p: string) => (p.endsWith('.tsx') ? 'tsx' : 'plaintext'),
}));

import { dispatchResultToEnvelope, runTool } from '../dispatcher';
import type { EditorToolContext } from '../editor-tools';
import { parseToolCallEnvelopes } from '../../runtime/message-parser';

function makeCtx(overrides: Partial<EditorToolContext> = {}): EditorToolContext {
  const files: Record<string, string> = {
    '/home/project/foo.tsx': 'const a = 1;\nconst b = 2;\n',
    '/home/project/src/App.tsx': 'export default function App() { return null; }\n',
  };
  return {
    resolvePath: (p) => {
      if (files[p]) return p;
      const cleaned = p.replace(/^\/+/, '');
      return Object.keys(files).find((f) => f.endsWith(`/${cleaned}`));
    },
    readFile: async (p) => files[p],
    openInEditor: vi.fn(),
    scrollTo: vi.fn(),
    runShell: vi.fn(async () => ({ output: 'hello', exitCode: 0 })),
    listFiles: () => Object.entries(files).map(([path, content]) => ({ path, size: content.length })),
    getEditorSelection: () => ({
      path: '/home/project/foo.tsx',
      text: 'const a = 1;',
      from: { line: 1, column: 1 },
      to: { line: 1, column: 13 },
    }),
    replaceEditorSelection: vi.fn(() => true),
    ...overrides,
  };
}

describe('runTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('openFile returns the file contents + detected language + line_count', async () => {
    const ctx = makeCtx();
    const result = await runTool('openFile', { path: 'foo.tsx' }, ctx, 't_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.result);
    expect(parsed.contents).toContain('const a = 1');
    expect(parsed.language).toBe('tsx');
    expect(parsed.line_count).toBe(3);
    expect(ctx.openInEditor).toHaveBeenCalledWith('/home/project/foo.tsx');
  });

  it('Zod validator rejects invalid args without invoking the handler', async () => {
    const ctx = makeCtx();
    const result = await runTool('openFile', { wrong: 'shape' }, ctx, 't_2');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_args');
    expect(result.error.message).toMatch(/path/);
    expect(ctx.openInEditor).not.toHaveBeenCalled();
  });

  it('unknown tool returns an unknown_tool error', async () => {
    const result = await runTool('doesNotExist', {}, makeCtx(), 't_3');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown_tool');
  });

  it('runCommand truncates output beyond the 8KB budget', async () => {
    const huge = 'x'.repeat(20_000);
    const ctx = makeCtx({ runShell: async () => ({ output: huge, exitCode: 0 }) });
    const result = await runTool('runCommand', { command: 'cat big.txt' }, ctx, 't_4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.result);
    expect(parsed.output.length).toBeLessThan(huge.length);
    expect(parsed.output).toContain('truncated');
    expect(parsed.exitCode).toBe(0);
  });

  it('search returns matches across files with line numbers', async () => {
    const ctx = makeCtx();
    const result = await runTool('search', { query: 'const' }, ctx, 't_5');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.result);
    expect(parsed.matches.length).toBeGreaterThan(0);
    expect(parsed.matches[0]).toHaveProperty('line');
    expect(parsed.matches[0]).toHaveProperty('path');
  });

  it('getSelection round-trips the editor selection shape', async () => {
    const result = await runTool('getSelection', {}, makeCtx(), 't_6');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.result);
    expect(parsed.ok).toBe(true);
    expect(parsed.text).toBe('const a = 1;');
    expect(parsed.from).toEqual({ line: 1, column: 1 });
  });

  it('handler failures surface as handler_failed (never throw)', async () => {
    const ctx = makeCtx({
      readFile: async () => {
        throw new Error('disk on fire');
      },
    });
    const result = await runTool('openFile', { path: 'foo.tsx' }, ctx, 't_7');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('handler_failed');
    expect(result.error.message).toBe('disk on fire');
  });

  it('dispatchResultToEnvelope frames success as <tool_result id="…">', async () => {
    const ctx = makeCtx();
    const result = await runTool('openFile', { path: 'foo.tsx' }, ctx, 't_8');
    const envelope = dispatchResultToEnvelope(result);
    expect(envelope).toMatch(/^<tool_result id="t_8">/);
    expect(envelope).toMatch(/<\/tool_result>$/);
  });

  it('dispatchResultToEnvelope frames failures as JSON {error:…}', async () => {
    const result = await runTool('openFile', {}, makeCtx(), 't_9');
    const envelope = dispatchResultToEnvelope(result);
    expect(envelope).toContain('"error"');
    expect(envelope).toContain('invalid_args');
  });
});

describe('parseToolCallEnvelopes', () => {
  it('extracts a complete envelope from streamed text', () => {
    const text = 'Let me open that. <tool_call name="openFile" id="t_42">{"args":{"path":"src/App.tsx"}}</tool_call>';
    const envelopes = parseToolCallEnvelopes(text);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toEqual({
      name: 'openFile',
      id: 't_42',
      args: { path: 'src/App.tsx' },
    });
  });

  it('returns empty when no envelope is complete yet', () => {
    expect(parseToolCallEnvelopes('Let me open that. <tool_call name="openFile" id="t_42">{"a')).toEqual([]);
  });

  it('accepts bare-args shape (no {args} wrapper)', () => {
    const text = '<tool_call name="jumpToLine" id="t_50">{"path":"foo.tsx","line":12}</tool_call>';
    const envelopes = parseToolCallEnvelopes(text);
    expect(envelopes[0].args).toEqual({ path: 'foo.tsx', line: 12 });
  });
});
