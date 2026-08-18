/**
 * Edge AI Router — classification + routing unit coverage.
 *
 * `classifyPromptTier` is THE edge decision (deterministic, sub-ms): quick Q&A
 * → Workers AI (instant), build/code → DeepSeek (standard), reasoning → premium.
 */
import { classifyPromptTier, tierFromModelHint } from '../services/edge_ai_router.js';

describe('classifyPromptTier — the edge decision', () => {
  it('short Q&A → instant (Workers AI, free)', () => {
    expect(classifyPromptTier([{ role: 'user', content: 'what is 2+2?' }])).toBe('instant');
    expect(classifyPromptTier([{ role: 'user', content: 'hello!' }])).toBe('instant');
    expect(classifyPromptTier([{ role: 'user', content: 'what does SEO mean?' }])).toBe('instant');
  });

  it('build/code intent → standard (DeepSeek generation tier)', () => {
    expect(
      classifyPromptTier([{ role: 'user', content: 'build a hero section with tailwind css' }]),
    ).toBe('standard');
    expect(classifyPromptTier([{ role: 'user', content: 'create a contact page' }])).toBe(
      'standard',
    );
    expect(
      classifyPromptTier([{ role: 'user', content: 'fix the bug in my react component' }]),
    ).toBe('standard');
  });

  it('reasoning intent → premium', () => {
    expect(
      classifyPromptTier([
        { role: 'user', content: 'analyze the architecture trade-offs step by step' },
      ]),
    ).toBe('premium');
    expect(
      classifyPromptTier([{ role: 'user', content: 'explain why this algorithm is O(n log n)' }]),
    ).toBe('premium');
  });

  it('long messages (>800 chars) → premium even without reasoning keywords', () => {
    const long = `Describe ${'a'.repeat(850)}`;
    expect(classifyPromptTier([{ role: 'user', content: long }])).toBe('premium');
  });

  it('model hints override heuristics (the bolt model chip wins)', () => {
    expect(tierFromModelHint('claude-opus-4-6')).toBe('premium');
    expect(classifyPromptTier([{ role: 'user', content: 'hi' }], 'claude-opus-4-6')).toBe('premium');
    expect(classifyPromptTier([{ role: 'user', content: 'hi' }], 'deepseek-chat')).toBe('standard');
    expect(tierFromModelHint('unknown-model')).toBeNull();
  });

  it('reads the LAST user turn only (earlier turns ignored)', () => {
    expect(
      classifyPromptTier([
        { role: 'user', content: 'analyze the whole system architecture deeply' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'ok thanks' },
      ]),
    ).toBe('instant');
  });
});
