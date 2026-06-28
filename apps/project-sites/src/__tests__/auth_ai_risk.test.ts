/**
 * auth_ai_risk — AI-native login-risk scoring (#45). Locks the Zod contract,
 * JSON extraction from prose, and the fail-safe (challenge, never allow) on error.
 */
import { assessLoginRisk, LoginRiskSchema } from '../services/auth_ai_risk.js';

const envWith = (run: (...a: unknown[]) => unknown) => ({ AI: { run } }) as never;
const ctx = { reasons: ['new_ip', 'new_device'], ip: '203.0.113.4', userAgent: 'UA/1' };

describe('assessLoginRisk', () => {
  it('returns the validated verdict from a clean JSON response', async () => {
    const env = envWith(async () => ({
      response:
        '{"risk":0.8,"recommendation":"block","reason":"New IP and device from unknown ASN."}',
    }));
    const v = await assessLoginRisk(env, ctx);
    expect(v.recommendation).toBe('block');
    expect(v.risk).toBe(0.8);
    expect(LoginRiskSchema.safeParse(v).success).toBe(true);
  });

  it('extracts JSON even when the model wraps it in prose', async () => {
    const env = envWith(async () => ({
      response:
        'Sure! Here is my assessment: {"risk":0.4,"recommendation":"challenge","reason":"Moderate."} Hope that helps.',
    }));
    const v = await assessLoginRisk(env, ctx);
    expect(v.recommendation).toBe('challenge');
    expect(v.risk).toBe(0.4);
  });

  it('fails safe to challenge when the response is not JSON', async () => {
    const env = envWith(async () => ({ response: 'I cannot help with that.' }));
    const v = await assessLoginRisk(env, ctx);
    expect(v.recommendation).toBe('challenge');
    expect(v.reason).toContain('unavailable');
  });

  it('fails safe to challenge when the JSON violates the schema', async () => {
    const env = envWith(async () => ({ response: '{"risk":5,"recommendation":"nuke"}' }));
    const v = await assessLoginRisk(env, ctx);
    expect(v.recommendation).toBe('challenge');
  });

  it('fails safe to challenge when the AI binding throws', async () => {
    const env = envWith(async () => {
      throw new Error('AI down');
    });
    const v = await assessLoginRisk(env, ctx);
    expect(v.recommendation).toBe('challenge');
    expect(v.risk).toBe(0.5);
  });
});
