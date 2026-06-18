import { handleClaimBuildResult } from '../services/claim_build_completion';

/**
 * #1 claimyour.site — the build-completion orchestration glue the generation
 * workflow calls when a claim build finishes/fails. DI'd (applyEvent / getLead /
 * sendEmail) so the load→terminal-event→email round-trip is unit-provable with no
 * D1/email/network.
 */
function deps(
  over: Partial<{ applyEvent: jest.Mock; getLead: jest.Mock; sendEmail: jest.Mock }> = {},
) {
  return {
    applyEvent: over.applyEvent ?? jest.fn().mockResolvedValue(undefined),
    getLead:
      over.getLead ??
      jest.fn().mockResolvedValue({ profile: { businessName: 'Acme', email: 'owner@acme.com' } }),
    sendEmail: over.sendEmail ?? jest.fn().mockResolvedValue({ ok: true }),
  };
}

describe('handleClaimBuildResult', () => {
  it('on success: marks the session completed + emails the preview link', async () => {
    const d = deps();
    const r = await handleClaimBuildResult(d, {
      sessionId: 'claim_x',
      leadId: 'lead_1',
      ok: true,
      previewUrl: 'https://acme.projectsites.dev',
    });
    expect(r.status).toBe('completed');
    expect(r.emailed).toBe(true);
    expect(d.applyEvent).toHaveBeenCalledWith(
      'claim_x',
      'lead_1',
      expect.objectContaining({
        type: 'BUILD_COMPLETED',
        previewUrl: 'https://acme.projectsites.dev',
      }),
    );
    expect(d.sendEmail).toHaveBeenCalledWith(
      'finished',
      'owner@acme.com',
      expect.objectContaining({
        businessName: 'Acme',
        previewUrl: 'https://acme.projectsites.dev',
      }),
    );
  });

  it('on failure: marks the session failed + emails the recovery path', async () => {
    const d = deps();
    const r = await handleClaimBuildResult(d, {
      sessionId: 'claim_x',
      leadId: 'lead_1',
      ok: false,
      error: 'render timeout',
      createUrl: 'https://projectsites.dev/create?claim=x',
    });
    expect(r.status).toBe('failed');
    expect(d.applyEvent).toHaveBeenCalledWith(
      'claim_x',
      'lead_1',
      expect.objectContaining({ type: 'BUILD_FAILED', error: 'render timeout' }),
    );
    expect(d.sendEmail).toHaveBeenCalledWith(
      'failed',
      'owner@acme.com',
      expect.objectContaining({ businessName: 'Acme', error: 'render timeout' }),
    );
  });

  it('skips the email when the lead has no address (still applies the terminal event)', async () => {
    const d = deps({ getLead: jest.fn().mockResolvedValue({ profile: { businessName: 'Acme' } }) }); // no email
    const r = await handleClaimBuildResult(d, {
      sessionId: 'claim_x',
      leadId: 'lead_1',
      ok: true,
      previewUrl: 'https://p',
    });
    expect(r.status).toBe('completed');
    expect(r.emailed).toBe(false);
    expect(d.applyEvent).toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('still completes when the lead lookup fails (terminal event applied, no email)', async () => {
    const d = deps({ getLead: jest.fn().mockResolvedValue(null) });
    const r = await handleClaimBuildResult(d, {
      sessionId: 'claim_x',
      leadId: 'lead_1',
      ok: true,
      previewUrl: 'https://p',
    });
    expect(r.status).toBe('completed');
    expect(r.emailed).toBe(false);
    expect(d.applyEvent).toHaveBeenCalledWith(
      'claim_x',
      'lead_1',
      expect.objectContaining({ type: 'BUILD_COMPLETED' }),
    );
  });

  it('never throws when the email send fails (emailed:false, status unchanged)', async () => {
    const d = deps({ sendEmail: jest.fn().mockResolvedValue({ ok: false }) });
    const r = await handleClaimBuildResult(d, {
      sessionId: 'claim_x',
      leadId: 'lead_1',
      ok: true,
      previewUrl: 'https://p',
    });
    expect(r.status).toBe('completed');
    expect(r.emailed).toBe(false);
  });
});
