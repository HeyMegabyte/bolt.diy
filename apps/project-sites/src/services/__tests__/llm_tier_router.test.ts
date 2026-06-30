import { routeLlmTier } from '../llm_tier_router';

describe('routeLlmTier', () => {
  it('routes classification to instant', () => {
    const r = routeLlmTier({ task: 'classification' });
    expect(r.tier).toBe('instant');
  });

  it('routes embedding to instant', () => {
    expect(routeLlmTier({ task: 'embedding' }).tier).toBe('instant');
  });

  it('routes moderation to instant', () => {
    expect(routeLlmTier({ task: 'moderation' }).tier).toBe('instant');
  });

  it('routes generation to standard', () => {
    expect(routeLlmTier({ task: 'generation' }).tier).toBe('standard');
  });

  it('routes code_generation to standard', () => {
    expect(routeLlmTier({ task: 'code_generation' }).tier).toBe('standard');
  });

  it('routes architecture to premium', () => {
    expect(routeLlmTier({ task: 'architecture' }).tier).toBe('premium');
  });

  it('routes security_review to premium', () => {
    expect(routeLlmTier({ task: 'security_review' }).tier).toBe('premium');
  });

  it('routes reasoning to premium', () => {
    expect(routeLlmTier({ task: 'reasoning' }).tier).toBe('premium');
  });

  it('forces premium when vision is required', () => {
    const r = routeLlmTier({ task: 'classification', requiresVision: true });
    expect(r.tier).toBe('premium');
    expect(r.reason).toContain('Vision');
  });

  it('forces instant for latency-sensitive user-facing tasks', () => {
    const r = routeLlmTier({ task: 'generation', latencySensitive: true, userFacing: true });
    expect(r.tier).toBe('instant');
  });

  it('forces instant when open-source is required', () => {
    const r = routeLlmTier({ task: 'code_generation', requireOpenSource: true });
    expect(r.tier).toBe('instant');
  });

  it('marks generation as downgradable', () => {
    expect(routeLlmTier({ task: 'generation' }).downgradable).toBe(true);
  });

  it('marks architecture as NOT downgradable', () => {
    expect(routeLlmTier({ task: 'architecture' }).downgradable).toBe(false);
  });

  it('provides standard as fallback for premium', () => {
    expect(routeLlmTier({ task: 'architecture' }).fallback).toBe('standard');
  });

  it('provides instant as fallback for standard', () => {
    expect(routeLlmTier({ task: 'generation' }).fallback).toBe('instant');
  });

  it('returns a human-readable reason', () => {
    const r = routeLlmTier({ task: 'summarization' });
    expect(r.reason.length).toBeGreaterThan(10);
    expect(r.reason).toContain('summarization');
  });

  it('vision beats latency sensitivity', () => {
    const r = routeLlmTier({
      task: 'classification',
      requiresVision: true,
      latencySensitive: true,
      userFacing: true,
    });
    expect(r.tier).toBe('premium'); // vision wins
  });
});
