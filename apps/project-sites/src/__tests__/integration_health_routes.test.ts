/**
 * Unit tests for integration health endpoints.
 *
 * Tests the route handler logic by calling the Hono app directly with
 * a minimal mocked Env binding.
 */
import { Hono } from 'hono';
import { integrationHealth, KNOWN_INTEGRATIONS } from '../routes/integration_health';
import type { Env, Variables } from '../types/env';

/** Build a minimal mock Env with the fields the health route reads. */
function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    LISTMONK_BASE_URL: 'https://mail.projectsites.dev',
    LISTMONK_API_USER: 'projectsites',
    LISTMONK_API_KEY: 'test-key',
    TWENTY_API_URL: 'https://crm.projectsites.dev',
    TWENTY_API_KEY: 'test-jwt',
    STRIPE_SECRET_KEY: 'sk_test_...',
    RESEND_API_KEY: 're_test_...',
    DITTOFEED_ADMIN_API_KEY: 'df_test_...',
    DEEPGRAM_API_KEY: 'dg_test_...',
    LAGO_API_KEY: 'lago_test_...',
    ...overrides,
  } as unknown as Env;
}

describe('GET /api/integrations/:name/health', () => {
  it('rejects unknown integration with 404', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.route('/', integrationHealth);
    const req = new Request('https://projectsites.dev/api/integrations/foobar/health');
    const res = await app.fetch(req, mockEnv());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('unknown_integration');
  });

  it('returns health for listmonk', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.route('/', integrationHealth);
    const req = new Request('https://projectsites.dev/api/integrations/listmonk/health');
    const res = await app.fetch(req, mockEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.integration).toBe('listmonk');
    expect(body.status).toBeDefined();
    expect(Array.isArray(body.signals)).toBe(true);
    expect(body.timestamp).toBeDefined();
  });

  it('returns unknown status for unconfigured integration', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.route('/', integrationHealth);
    const req = new Request('https://projectsites.dev/api/integrations/twenty/health');
    const res = await app.fetch(req, mockEnv({ TWENTY_API_KEY: '' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.signals[0].configured).toBe(false);
    expect(body.signals[0].health).toBe('unknown');
  });
});

describe('GET /api/integrations/health', () => {
  it('returns all known integrations', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.route('/', integrationHealth);
    const req = new Request('https://projectsites.dev/api/integrations/health');
    const env = mockEnv({
      TWENTY_API_KEY: '',
      RESEND_API_KEY: '',
      DITTOFEED_ADMIN_API_KEY: '',
      DEEPGRAM_API_KEY: '',
      LAGO_API_KEY: '',
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.integrations)).toBe(true);
    expect(body.integrations.length).toBe(KNOWN_INTEGRATIONS.size);
    // Each entry has the expected shape
    for (const entry of body.integrations) {
      expect(entry).toHaveProperty('integration');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('configured');
    }
    expect(body.timestamp).toBeDefined();
  });

  it('marks listmonk as unknown when unconfigured', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.route('/', integrationHealth);
    const req = new Request('https://projectsites.dev/api/integrations/health');
    const env = mockEnv({ LISTMONK_API_KEY: '' });
    const res = await app.fetch(req, env);
    const body = (await res.json()) as any;
    const lm = body.integrations.find((i: any) => i.integration === 'listmonk');
    expect(lm.status).toBe('unknown');
    expect(lm.configured).toBe(false);
  });
});
