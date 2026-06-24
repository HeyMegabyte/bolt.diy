/**
 * feature_evaluation — §33 OpenFeature evaluation port over the D1 flag engine.
 *
 * Locks the port contract (EvaluationContext schema, Fake provider) and the D1
 * adapter (context→scope mapping, OpenFeature ResolutionDetails shaping, fail-soft
 * on a thrown engine error). The flag engine's `isFlagOn` is mocked so no D1/KV
 * I/O happens. Global `jest`; casts via `as unknown as jest.Mock`.
 */
jest.mock('../modules/feature_flags/services.js', () => ({ isFlagOn: jest.fn() }));

import {
  EvaluationContextSchema,
  FakeFeatureEvaluationProvider,
} from '../platform/feature-evaluation.js';
import {
  D1FlagEvaluationProvider,
  getFeatureEvaluationProvider,
} from '../middleware/feature-evaluation.js';
import { isFlagOn } from '../modules/feature_flags/services.js';

const mIsFlagOn = isFlagOn as unknown as jest.Mock;
const env = {} as never;

beforeEach(() => jest.clearAllMocks());

describe('EvaluationContextSchema', () => {
  it('accepts the known scope fields', () => {
    const r = EvaluationContextSchema.safeParse({ targetingKey: 'u1', siteId: 's1', orgId: 'o1' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown fields (strict)', () => {
    const r = EvaluationContextSchema.safeParse({ bogus: 1 });
    expect(r.success).toBe(false);
  });
});

describe('FakeFeatureEvaluationProvider', () => {
  it('returns a mapped flag with reason STATIC', async () => {
    const p = new FakeFeatureEvaluationProvider({ ai_concierge_widget: true });
    expect(await p.resolveBooleanEvaluation('ai_concierge_widget', false)).toEqual({
      value: true,
      reason: 'STATIC',
    });
  });

  it('falls back to the caller default with reason DEFAULT', async () => {
    const p = new FakeFeatureEvaluationProvider({});
    expect(await p.resolveBooleanEvaluation('unknown', true)).toEqual({
      value: true,
      reason: 'DEFAULT',
    });
  });
});

describe('D1FlagEvaluationProvider', () => {
  it('shapes an enabled flag as TARGETING_MATCH', async () => {
    mIsFlagOn.mockResolvedValue(true);
    const p = new D1FlagEvaluationProvider(env);
    const res = await p.resolveBooleanEvaluation('storefront_ecommerce', false, { siteId: 's1' });
    expect(res).toEqual({
      value: true,
      reason: 'TARGETING_MATCH',
      flagMetadata: { source: 'd1-feature-flags' },
    });
  });

  it('shapes a disabled flag as DISABLED', async () => {
    mIsFlagOn.mockResolvedValue(false);
    const p = new D1FlagEvaluationProvider(env);
    const res = await p.resolveBooleanEvaluation('storefront_ecommerce', true);
    expect(res.value).toBe(false);
    expect(res.reason).toBe('DISABLED');
  });

  it('maps targetingKey → userId scope when userId is absent', async () => {
    mIsFlagOn.mockResolvedValue(true);
    const p = new D1FlagEvaluationProvider(env);
    await p.resolveBooleanEvaluation('flag', false, { targetingKey: 'user-42', siteId: 's1' });
    expect(mIsFlagOn).toHaveBeenCalledWith(env, 'flag', {
      orgId: undefined,
      siteId: 's1',
      userId: 'user-42',
      anonId: undefined,
    });
  });

  it('fails soft to the caller default with reason ERROR when the engine throws', async () => {
    mIsFlagOn.mockRejectedValue(new Error('KV down'));
    const p = new D1FlagEvaluationProvider(env);
    const res = await p.resolveBooleanEvaluation('flag', true);
    expect(res).toEqual({ value: true, reason: 'ERROR', errorCode: 'GENERAL' });
  });
});

describe('getFeatureEvaluationProvider', () => {
  it('returns the D1-backed provider (always available, no env gate)', () => {
    const p = getFeatureEvaluationProvider(env);
    expect(p.name).toBe('projectsites-d1-flags');
    expect(p).toBeInstanceOf(D1FlagEvaluationProvider);
  });
});
