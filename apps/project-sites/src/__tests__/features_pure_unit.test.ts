/**
 * Unit tests for the pure functions exported from services/features.ts.
 * No network, no D1, no mocks — plain inputs → assert outputs.
 *
 * Picked because estimateRebuildMinutes in import_crawler.ts is already
 * covered by import_crawler.test.ts; these are the nearest clearly-PURE
 * untested exports in src/services/.
 */

import { estimatePromptCost, listModels, pickModel } from '../services/features.js';
import type { ModelId } from '../services/features.js';

// ───────────── listModels ─────────────

describe('listModels', () => {
  it('returns an array', () => {
    const models = listModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it('every entry has id, input, output, free, label fields', () => {
    for (const m of listModels()) {
      expect(typeof m.id).toBe('string');
      expect(typeof m.input).toBe('number');
      expect(typeof m.output).toBe('number');
      expect(typeof m.free).toBe('boolean');
      expect(typeof m.label).toBe('string');
    }
  });

  it('includes the free Workers AI model', () => {
    const ids = listModels().map((m) => m.id);
    expect(ids).toContain('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('free model has zero rates', () => {
    const free = listModels().find((m) => m.id === '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(free?.input).toBe(0);
    expect(free?.output).toBe(0);
    expect(free?.free).toBe(true);
  });

  it('is deterministic across multiple calls', () => {
    expect(listModels()).toEqual(listModels());
  });
});

// ───────────── estimatePromptCost ─────────────

describe('estimatePromptCost', () => {
  const SONNET: ModelId = 'claude-sonnet-4-6';
  const OPUS: ModelId = 'claude-opus-4-7';
  const FREE: ModelId = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

  it('returns { usd, free, model }', () => {
    const result = estimatePromptCost(SONNET, 100, 50);
    expect(typeof result.usd).toBe('number');
    expect(typeof result.free).toBe('boolean');
    expect(result.model).toBe(SONNET);
  });

  it('zero tokens → zero usd', () => {
    expect(estimatePromptCost(SONNET, 0, 0).usd).toBe(0);
    expect(estimatePromptCost(OPUS, 0, 0).usd).toBe(0);
  });

  it('free model → usd is always 0', () => {
    expect(estimatePromptCost(FREE, 1_000_000, 1_000_000).usd).toBe(0);
    expect(estimatePromptCost(FREE, 0, 0).free).toBe(true);
  });

  it('Sonnet: correct per-MTok rates ($3 input / $15 output)', () => {
    // 1M input tokens at $3/MTok = $3.000000
    const inputOnly = estimatePromptCost(SONNET, 1_000_000, 0);
    expect(inputOnly.usd).toBeCloseTo(3.0, 4);

    // 1M output tokens at $15/MTok = $15.000000
    const outputOnly = estimatePromptCost(SONNET, 0, 1_000_000);
    expect(outputOnly.usd).toBeCloseTo(15.0, 4);
  });

  it('Opus: correct per-MTok rates ($15 input / $75 output)', () => {
    const inputOnly = estimatePromptCost(OPUS, 1_000_000, 0);
    expect(inputOnly.usd).toBeCloseTo(15.0, 4);

    const outputOnly = estimatePromptCost(OPUS, 0, 1_000_000);
    expect(outputOnly.usd).toBeCloseTo(75.0, 4);
  });

  it('usd is rounded to 6 decimal places', () => {
    const result = estimatePromptCost(SONNET, 1, 1);
    const decimals = result.usd.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(6);
  });

  it('non-free model returns free=false', () => {
    expect(estimatePromptCost(SONNET, 100, 100).free).toBe(false);
    expect(estimatePromptCost(OPUS, 100, 100).free).toBe(false);
  });

  it('cost is monotone: more tokens → more cost for paid models', () => {
    const low = estimatePromptCost(SONNET, 100, 100).usd;
    const high = estimatePromptCost(SONNET, 200, 200).usd;
    expect(high).toBeGreaterThan(low);
  });

  it('input and output tokens are additive', () => {
    const combined = estimatePromptCost(SONNET, 500_000, 500_000).usd;
    const inputHalf = estimatePromptCost(SONNET, 500_000, 0).usd;
    const outputHalf = estimatePromptCost(SONNET, 0, 500_000).usd;
    expect(combined).toBeCloseTo(inputHalf + outputHalf, 5);
  });
});

// ───────────── pickModel ─────────────

describe('pickModel', () => {
  it('free shape → Workers AI model', () => {
    expect(pickModel('free')).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('complex shape → Opus', () => {
    expect(pickModel('complex')).toBe('claude-opus-4-7');
  });

  it('creative shape → Sonnet', () => {
    expect(pickModel('creative')).toBe('claude-sonnet-4-6');
  });

  it('simple shape → free Workers AI model', () => {
    expect(pickModel('simple')).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('valid userPref overrides shape', () => {
    const pref: ModelId = 'claude-opus-4-7';
    expect(pickModel('free', pref)).toBe('claude-opus-4-7');
    expect(pickModel('simple', pref)).toBe('claude-opus-4-7');
    expect(pickModel('creative', pref)).toBe('claude-opus-4-7');
  });

  it('all listed model IDs are valid user prefs', () => {
    for (const m of listModels()) {
      const id = m.id as ModelId;
      expect(pickModel('complex', id)).toBe(id);
    }
  });
});
