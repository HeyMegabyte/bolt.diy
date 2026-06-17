import { Hono } from 'hono';
import { aiActions } from '../routes/ai_actions';
import { isFlagOn } from '../modules/feature_flags/services.js';

/**
 * #4 AI payment-command — the HTTP transport guards layered on the pure policy
 * core (assessPaymentCommand, already unit-proven). These lock the route's own
 * contract: auth-required, flag-gated (404 not 403), tenant bound to the SESSION
 * (never the client body), and every policy reject mapped to a 400 envelope with
 * the exact stable code. The flag service is mocked so no KV/D1 is touched.
 */
jest.mock('../modules/feature_flags/services.js', () => ({ isFlagOn: jest.fn() }));
const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;

/** Mount the route behind a middleware that injects the authed-session vars. */
function makeApp(auth: { userId?: string; orgId?: string }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (auth.userId) c.set('userId', auth.userId);
    if (auth.orgId) c.set('orgId', auth.orgId);
    c.set('requestId', 'req_test');
    await next();
  });
  app.route('/', aiActions);
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request(
    '/api/ai-actions/payment-command',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    {} as never,
  );
}

const validBody = {
  site_id: 'site_1',
  command: 'Charge $50',
  payment_method_ref: 'pm_123',
  reason: 'invoice #42',
};

describe('POST /api/ai-actions/payment-command', () => {
  beforeEach(() => mockIsFlagOn.mockReset());

  it('401s when unauthenticated (never anonymous)', async () => {
    const res = await post(makeApp({}), validBody);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('404s (not 403) when the flag is off — existence not leaked', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await post(makeApp({ userId: 'u1', orgId: 'o1' }), validBody);
    expect(res.status).toBe(404);
    expect(mockIsFlagOn).toHaveBeenCalledWith(expect.anything(), 'ai_payment_command', {
      orgId: 'o1',
      userId: 'u1',
    });
  });

  it('dry-run (default) → 200 preview + confirmation token, no charge', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await post(makeApp({ userId: 'u1', orgId: 'o1' }), validBody);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { stage: string; confirmation_token: string; preview: { amountCents: number } };
    };
    expect(json.data.stage).toBe('dry_run');
    expect(json.data.confirmation_token.length).toBeGreaterThan(0);
    expect(json.data.preview.amountCents).toBe(5000);
  });

  it('binds tenant_id to the SESSION org, ignoring any client-supplied tenant_id', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await post(makeApp({ userId: 'u1', orgId: 'real_org' }), {
      ...validBody,
      tenant_id: 'attacker_org',
    });
    const json = (await res.json()) as { data: { preview: { tenantId: string } } };
    expect(json.data.preview.tenantId).toBe('real_org');
  });

  it('maps a policy reject to a 400 with the exact stable code (raw card)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await post(makeApp({ userId: 'u1', orgId: 'o1' }), {
      ...validBody,
      command: 'charge 4242424242424242',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; request_id: string } };
    expect(json.error.code).toBe('raw_card_forbidden');
    expect(json.error.request_id).toBe('req_test');
  });

  it('rejects with validation_error 400 when there is no org to bind (no tenant)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await post(makeApp({ userId: 'u1' }), validBody); // orgId absent
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_error');
  });

  it('a live charge with the matching confirmation token → 200 authorized, executed:false (no charge yet)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const app = makeApp({ userId: 'u1', orgId: 'o1' });
    const dry = (await (await post(app, validBody)).json()) as {
      data: { confirmation_token: string };
    };
    const res = await post(app, {
      ...validBody,
      dry_run: false,
      confirmation_token: dry.data.confirmation_token,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { stage: string; executed: boolean; idempotency_key: string };
    };
    expect(json.data.stage).toBe('authorized');
    expect(json.data.executed).toBe(false);
    expect(json.data.idempotency_key.length).toBeGreaterThan(0);
  });
});
