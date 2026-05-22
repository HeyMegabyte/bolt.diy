/**
 * @module __tests__/form-router-improve
 * @description Unit tests for the form-router prompt-improvement service.
 *
 * Covers:
 *   - empty/whitespace `value` → returns the SAMPLE_ROUTER_PROMPT seed
 *     deterministically (no LLM call, never throws)
 *   - non-empty `value` → invokes Workers AI, returns the improved text
 *   - LLM failure path → silently falls back to the seed (never 500s the
 *     calling endpoint)
 *   - all returned `text` payloads are ≥ 40 characters so the UI always
 *     gets a usable prompt
 */

import {
  improveRouterPrompt,
  SAMPLE_ROUTER_PROMPT,
} from '../services/form_router.js';

interface MinimalEnv {
  AI: { run: jest.Mock };
}

function makeEnv(runImpl: jest.Mock): MinimalEnv {
  return { AI: { run: runImpl } };
}

describe('improveRouterPrompt — empty value (seed mode)', () => {
  it('returns the SAMPLE_ROUTER_PROMPT verbatim when value is empty string', async () => {
    const env = makeEnv(jest.fn());
    const out = await improveRouterPrompt(env as never, '');
    expect(out.mode).toBe('seed');
    expect(out.text).toBe(SAMPLE_ROUTER_PROMPT);
    expect(out.text.length).toBeGreaterThanOrEqual(40);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('returns seed when value is undefined', async () => {
    const env = makeEnv(jest.fn());
    const out = await improveRouterPrompt(env as never, undefined);
    expect(out.mode).toBe('seed');
    expect(out.text.length).toBeGreaterThanOrEqual(40);
  });

  it('returns seed when value is null', async () => {
    const env = makeEnv(jest.fn());
    const out = await improveRouterPrompt(env as never, null);
    expect(out.mode).toBe('seed');
    expect(out.text.length).toBeGreaterThanOrEqual(40);
  });

  it('returns seed when value is only whitespace', async () => {
    const env = makeEnv(jest.fn());
    const out = await improveRouterPrompt(env as never, '   \n\t  ');
    expect(out.mode).toBe('seed');
    expect(out.text).toBe(SAMPLE_ROUTER_PROMPT);
  });
});

describe('improveRouterPrompt — non-empty value (improved mode)', () => {
  it('invokes the AI binding and returns the improved text', async () => {
    const rewritten =
      'TIGHTENED ROUTER PROMPT — route newsletter→mailchimp, contact→email, ' +
      'spam→noop. Output strict JSON: {tool, args, reason, spam, urgency}.';
    const run = jest.fn().mockResolvedValue({ response: rewritten });
    const env = makeEnv(run);
    const out = await improveRouterPrompt(
      env as never,
      'route newsletters to mailchimp and contacts to email',
    );
    expect(out.mode).toBe('improved');
    expect(out.text).toBe(rewritten);
    expect(out.text.length).toBeGreaterThanOrEqual(40);
    expect(run).toHaveBeenCalledTimes(1);
    const callArgs = run.mock.calls[0];
    expect(callArgs[0]).toBe('@cf/meta/llama-3.1-8b-instruct');
    const payload = callArgs[1] as { messages: { role: string; content: string }[] };
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0]?.role).toBe('system');
    expect(payload.messages[1]?.content).toContain('mailchimp');
  });

  it('strips wrapping quotes from the AI response', async () => {
    const run = jest.fn().mockResolvedValue({
      response: '"Quoted rewritten prompt that is long enough to pass the 40 char gate."',
    });
    const env = makeEnv(run);
    const out = await improveRouterPrompt(env as never, 'short input');
    expect(out.text.startsWith('"')).toBe(false);
    expect(out.text.endsWith('"')).toBe(false);
  });
});

describe('improveRouterPrompt — failure + degenerate output (graceful fallback)', () => {
  it('falls back to seed when AI throws', async () => {
    const run = jest.fn().mockRejectedValue(new Error('AI offline'));
    const env = makeEnv(run);
    const out = await improveRouterPrompt(env as never, 'route newsletters');
    expect(out.mode).toBe('seed');
    expect(out.text).toBe(SAMPLE_ROUTER_PROMPT);
    expect(out.text.length).toBeGreaterThanOrEqual(40);
  });

  it('falls back to seed when AI returns < 40 chars', async () => {
    const run = jest.fn().mockResolvedValue({ response: 'too short' });
    const env = makeEnv(run);
    const out = await improveRouterPrompt(env as never, 'route newsletters');
    expect(out.mode).toBe('seed');
    expect(out.text).toBe(SAMPLE_ROUTER_PROMPT);
  });

  it('falls back to seed when AI returns empty response', async () => {
    const run = jest.fn().mockResolvedValue({});
    const env = makeEnv(run);
    const out = await improveRouterPrompt(env as never, 'route newsletters');
    expect(out.mode).toBe('seed');
    expect(out.text.length).toBeGreaterThanOrEqual(40);
  });
});

describe('SAMPLE_ROUTER_PROMPT — shape contract', () => {
  it('is ≥ 40 chars (UI render gate)', () => {
    expect(SAMPLE_ROUTER_PROMPT.length).toBeGreaterThanOrEqual(40);
  });

  it('contains the strict-JSON output contract', () => {
    expect(SAMPLE_ROUTER_PROMPT).toContain('OUTPUT');
    expect(SAMPLE_ROUTER_PROMPT).toContain('tool');
    expect(SAMPLE_ROUTER_PROMPT).toContain('noop');
  });

  it('mentions {{business}} so the prompt-render replacement works', () => {
    expect(SAMPLE_ROUTER_PROMPT).toContain('{{business}}');
  });
});
