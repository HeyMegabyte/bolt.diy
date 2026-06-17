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
// The executor + Stripe seam are mocked so the route's authorized→charge wiring
// is tested without any network/D1; the executor's own guards are unit-proven
// separately in ai_payment_execute.test.ts.
jest.mock('../services/ai_payment_execute.js', () => ({
  executeAuthorizedPaymentCommand: jest.fn(),
  stripeOffSessionCharge: jest.fn(() => jest.fn()),
}));
jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockExecute = require('../services/ai_payment_execute.js')
  .executeAuthorizedPaymentCommand as jest.Mock;

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
  beforeEach(() => {
    mockIsFlagOn.mockReset();
    mockExecute.mockReset();
  });

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
    expect(mockExecute).not.toHaveBeenCalled(); // a dry-run never charges
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

  it('a live charge with the matching confirmation token executes the tool → 200 charged', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockExecute.mockResolvedValue({ ok: true, paymentIntentId: 'pi_1', status: 'succeeded' });
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
    const json = (await res.json()) as { data: { stage: string; payment_intent_id: string } };
    expect(json.data.stage).toBe('charged');
    expect(json.data.payment_intent_id).toBe('pi_1');
    // executed with the authorized intent + an idempotency key + injected deps.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [intentArg, idemArg] = mockExecute.mock.calls[0];
    expect(intentArg).toEqual(
      expect.objectContaining({ amountCents: 5000, paymentMethodRef: 'pm_123', tenantId: 'o1' }),
    );
    expect(typeof idemArg).toBe('string');
    expect(idemArg.length).toBeGreaterThan(0);
  });

  it('a declined / failed charge maps to 402 with the charge_failed code', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockExecute.mockResolvedValue({
      ok: false,
      code: 'charge_failed',
      message: 'The charge could not be completed.',
    });
    const app = makeApp({ userId: 'u1', orgId: 'o1' });
    const dry = (await (await post(app, validBody)).json()) as {
      data: { confirmation_token: string };
    };
    const res = await post(app, {
      ...validBody,
      dry_run: false,
      confirmation_token: dry.data.confirmation_token,
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('charge_failed');
  });
});
