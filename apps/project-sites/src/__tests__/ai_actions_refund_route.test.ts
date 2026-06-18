import { Hono } from 'hono';
import { aiActions } from '../routes/ai_actions';
import { isFlagOn } from '../modules/feature_flags/services.js';

/**
 * #4 AI payment-command — the refund + status HTTP transport guards layered on
 * the already-unit-proven executors (refundPayment / getPaymentStatus). These
 * lock the route contract: auth-required, flag-gated (404 not 403), tenant bound
 * to the SESSION (never the client body), Zod-validated body → validation_error,
 * and every executor reject mapped to the right status + stable code. The
 * executor + Stripe seam are mocked so no network/D1 is touched; the executors'
 * own guards live in ai_payment_refund.test.ts.
 */
jest.mock('../modules/feature_flags/services.js', () => ({ isFlagOn: jest.fn() }));
jest.mock('../services/ai_payment_execute.js', () => ({
  executeAuthorizedPaymentCommand: jest.fn(),
  stripeOffSessionCharge: jest.fn(() => jest.fn()),
  refundPayment: jest.fn(),
  getPaymentStatus: jest.fn(),
  stripeRefund: jest.fn(() => jest.fn()),
  stripeGetPaymentStatus: jest.fn(() => jest.fn()),
}));
jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const execMod = require('../services/ai_payment_execute.js');
const mockRefund = execMod.refundPayment as jest.Mock;
const mockStatus = execMod.getPaymentStatus as jest.Mock;

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

function postRefund(app: Hono, body: unknown) {
  return app.request(
    '/api/ai-actions/payment-refund',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    {} as never,
  );
}

function getStatus(app: Hono, pi: string) {
  return app.request(`/api/ai-actions/payment-status/${pi}`, { method: 'GET' }, {} as never);
}

const validRefund = {
  payment_intent_id: 'pi_abc123',
  amount_cents: 500,
  idempotency_key: 'idem_refund_001',
  site_id: 'site_1',
  reason: 'duplicate charge',
};

describe('POST /api/ai-actions/payment-refund', () => {
  beforeEach(() => {
    mockIsFlagOn.mockReset();
    mockRefund.mockReset();
  });

  it('401s when unauthenticated (a refund is never anonymous)', async () => {
    const res = await postRefund(makeApp({}), validRefund);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('404s (not 403) when the flag is off — existence not leaked', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await postRefund(makeApp({ userId: 'u1', orgId: 'o1' }), validRefund);
    expect(res.status).toBe(404);
    expect(mockIsFlagOn).toHaveBeenCalledWith(expect.anything(), 'ai_payment_command', {
      orgId: 'o1',
      userId: 'u1',
    });
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('validation_error 400 on a malformed body (missing idempotency_key)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const { idempotency_key, ...noKey } = validRefund;
    const res = await postRefund(makeApp({ userId: 'u1', orgId: 'o1' }), noKey);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_error');
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('success → 200 refund_id; binds tenant to the SESSION org', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockRefund.mockResolvedValue({ ok: true, refundId: 're_1', status: 'succeeded' });
    const res = await postRefund(makeApp({ userId: 'u1', orgId: 'real_org' }), validRefund);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { stage: string; refund_id: string } };
    expect(json.data.stage).toBe('refunded');
    expect(json.data.refund_id).toBe('re_1');
    expect(mockRefund).toHaveBeenCalledTimes(1);
    const [reqArg] = mockRefund.mock.calls[0];
    expect(reqArg).toEqual(
      expect.objectContaining({
        paymentIntentId: 'pi_abc123',
        amountCents: 500,
        tenantId: 'real_org',
        idempotencyKey: 'idem_refund_001',
      }),
    );
  });

  it('a null amount (full refund) is accepted and passed through', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockRefund.mockResolvedValue({ ok: true, refundId: 're_2', status: 'succeeded' });
    const { amount_cents, ...noAmount } = validRefund;
    const res = await postRefund(makeApp({ userId: 'u1', orgId: 'o1' }), noAmount);
    expect(res.status).toBe(200);
    expect(mockRefund.mock.calls[0][0]).toEqual(expect.objectContaining({ amountCents: null }));
  });

  it('a failed refund maps to 402 with the refund_failed code', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockRefund.mockResolvedValue({
      ok: false,
      code: 'refund_failed',
      message: 'The refund could not be completed.',
    });
    const res = await postRefund(makeApp({ userId: 'u1', orgId: 'o1' }), validRefund);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('refund_failed');
  });

  it('an executor precondition reject maps to 400 with its stable code', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockRefund.mockResolvedValue({
      ok: false,
      code: 'invalid_payment_intent',
      message: 'A valid payment-intent id (pi_…) is required to refund.',
    });
    const res = await postRefund(makeApp({ userId: 'u1', orgId: 'o1' }), validRefund);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_payment_intent',
    );
  });
});

describe('GET /api/ai-actions/payment-status/:paymentIntentId', () => {
  beforeEach(() => {
    mockIsFlagOn.mockReset();
    mockStatus.mockReset();
  });

  it('401s when unauthenticated', async () => {
    const res = await getStatus(makeApp({}), 'pi_abc');
    expect(res.status).toBe(401);
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('404s (not 403) when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await getStatus(makeApp({ userId: 'u1', orgId: 'o1' }), 'pi_abc');
    expect(res.status).toBe(404);
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('ok → 200 with the live status (read-only, no charge)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockStatus.mockResolvedValue({
      ok: true,
      paymentIntentId: 'pi_abc',
      status: 'succeeded',
      amountCents: 5000,
    });
    const res = await getStatus(makeApp({ userId: 'u1', orgId: 'o1' }), 'pi_abc');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { payment_intent_id: string; status: string; amount_cents: number };
    };
    expect(json.data.payment_intent_id).toBe('pi_abc');
    expect(json.data.status).toBe('succeeded');
    expect(json.data.amount_cents).toBe(5000);
    expect(mockStatus).toHaveBeenCalledWith('pi_abc', expect.anything());
  });

  it('invalid id → 400 invalid_payment_intent', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockStatus.mockResolvedValue({
      ok: false,
      code: 'invalid_payment_intent',
      message: 'A valid payment-intent id (pi_…) is required.',
    });
    const res = await getStatus(makeApp({ userId: 'u1', orgId: 'o1' }), 'nope');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'invalid_payment_intent',
    );
  });

  it('an unavailable lookup → 404 status_unavailable', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockStatus.mockResolvedValue({
      ok: false,
      code: 'status_unavailable',
      message: 'The payment status could not be retrieved.',
    });
    const res = await getStatus(makeApp({ userId: 'u1', orgId: 'o1' }), 'pi_missing');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'status_unavailable',
    );
  });
});
