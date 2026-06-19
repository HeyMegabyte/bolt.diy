import { NovuEventSchema, triggerNovu } from '../services/novu_triggers';

describe('NovuEventSchema', () => {
  it('accepts a valid build.finished payload', () => {
    const result = NovuEventSchema.safeParse({
      event: 'build.finished',
      tenantId: 'org-123',
      siteId: 'site-abc',
      previewUrl: 'https://example.projectsites.dev',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid build.failed payload', () => {
    const result = NovuEventSchema.safeParse({
      event: 'build.failed',
      tenantId: 'org-123',
      error: 'Container timeout',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid payment.succeeded payload', () => {
    const result = NovuEventSchema.safeParse({
      event: 'payment.succeeded',
      tenantId: 'org-123',
      amountCents: 2900,
      currency: 'usd',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid lead.scan.completed payload', () => {
    const result = NovuEventSchema.safeParse({
      event: 'lead.scan.completed',
      tenantId: 'org-123',
      leadCount: 42,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload with an unknown event type', () => {
    const result = NovuEventSchema.safeParse({
      event: 'unknown.event',
      tenantId: 'org-123',
    });
    expect(result.success).toBe(false);
  });

  it.each([
    { event: 'domain.verifying', tenantId: 'o1', hostname: 'www.acme.com' },
    { event: 'domain.active', tenantId: 'o1', hostname: 'www.acme.com' },
    { event: 'domain.failed', tenantId: 'o1', hostname: 'www.acme.com', error: 'DNS not found' },
    { event: 'quota.near_limit', tenantId: 'o1', resource: 'ai_budget', usedPercent: 82 },
    { event: 'trial.ending', tenantId: 'o1', daysRemaining: 3 },
    { event: 'member.invited', tenantId: 'o1', email: 'new@acme.com', role: 'editor' },
    { event: 'member.joined', tenantId: 'o1', userId: 'u9', role: 'editor' },
    { event: 'ai.job.completed', tenantId: 'o1', jobId: 'j1', traceId: 't1' },
    { event: 'ai.job.failed', tenantId: 'o1', jobId: 'j1', error: 'model timeout' },
    { event: 'browser.job.escalated', tenantId: 'o1', runId: 'r1', fromProvider: 'cloudflare', toProvider: 'browserbase' },
    { event: 'db.provision.queued', tenantId: 'o1', dbId: 'db1' },
    { event: 'db.provision.ready', tenantId: 'o1', dbId: 'db1' },
    { event: 'db.provision.failed', tenantId: 'o1', dbId: 'db1', error: 'capacity exhausted' },
  ])('accepts a valid $event payload', (payload) => {
    expect(NovuEventSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects member.invited with a non-email address', () => {
    const result = NovuEventSchema.safeParse({
      event: 'member.invited',
      tenantId: 'o1',
      email: 'not-an-email',
      role: 'editor',
    });
    expect(result.success).toBe(false);
  });

  it('rejects quota.near_limit with usedPercent over 100', () => {
    const result = NovuEventSchema.safeParse({
      event: 'quota.near_limit',
      tenantId: 'o1',
      resource: 'ai_budget',
      usedPercent: 140,
    });
    expect(result.success).toBe(false);
  });

  it('rejects domain.failed missing the error reason', () => {
    const result = NovuEventSchema.safeParse({
      event: 'domain.failed',
      tenantId: 'o1',
      hostname: 'www.acme.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a build.finished payload missing previewUrl', () => {
    const result = NovuEventSchema.safeParse({
      event: 'build.finished',
      tenantId: 'org-123',
    });
    expect(result.success).toBe(false);
  });
});

describe('triggerNovu', () => {
  const validPayload = {
    event: 'build.finished' as const,
    tenantId: 'org-123',
    siteId: 'site-abc',
    previewUrl: 'https://example.projectsites.dev',
  };

  it('valid build.finished payload calls deps.send with the workflowId and returns ok', async () => {
    const mockSend = jest.fn().mockResolvedValue({ transactionId: 'txn-999' });
    const result = await triggerNovu(
      'build-finished',
      {
        subscriberId: 'user-123',
        payload: validPayload,
      },
      { send: mockSend },
    );

    expect(result.ok).toBe(true);
    expect(result.transactionId).toBe('txn-999');
    expect(mockSend).toHaveBeenCalledWith('build-finished', {
      subscriberId: 'user-123',
      payload: validPayload,
    });
  });

  it('invalid payload returns invalid_payload and does NOT call deps.send', async () => {
    const mockSend = jest.fn();
    const result = await triggerNovu(
      'build-finished',
      {
        subscriberId: 'user-123',
        payload: { event: 'build.finished', tenantId: 'org-123' }, // missing previewUrl
      },
      { send: mockSend },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_payload');
    }
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('missing subscriberId returns no_subscriber and does NOT call deps.send', async () => {
    const mockSend = jest.fn();
    const result = await triggerNovu(
      'build-finished',
      {
        subscriberId: '',
        payload: validPayload,
      },
      { send: mockSend },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_subscriber');
    }
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('deps.send throw maps to send_failed', async () => {
    const mockSend = jest.fn().mockRejectedValue(new Error('Novu API error'));
    const result = await triggerNovu(
      'build-finished',
      {
        subscriberId: 'user-123',
        payload: validPayload,
      },
      { send: mockSend },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('send_failed');
    }
  });

  it('success returns transactionId from deps.send', async () => {
    const mockSend = jest.fn().mockResolvedValue({ transactionId: 'txn-abc-789' });
    const result = await triggerNovu(
      'payment-succeeded',
      {
        subscriberId: 'user-456',
        payload: {
          event: 'payment.succeeded' as const,
          tenantId: 'org-456',
          amountCents: 9900,
          currency: 'usd',
        },
      },
      { send: mockSend },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transactionId).toBe('txn-abc-789');
    }
  });

  it('valid build.started payload triggers send', async () => {
    const mockSend = jest.fn().mockResolvedValue({ transactionId: 'txn-started' });
    const result = await triggerNovu(
      'build-started',
      {
        subscriberId: 'user-777',
        payload: {
          event: 'build.started' as const,
          tenantId: 'org-777',
          siteId: 'site-xyz',
        },
      },
      { send: mockSend },
    );

    expect(result.ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
