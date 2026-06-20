/**
 * Convergence §20/§23 — InngestJobProvider adapter.
 *
 * Locks: event-driven kinds dispatch via inngest.send with id=idempotencyKey
 * (server-side dedupe), the routed context rides in the event data, and the
 * adapter refuses kinds that don't route to the inngest plane.
 */
import { InngestJobProvider, type InngestSender } from '../inngest/job-provider.js';
import type { ProjectSitesJobContext } from '../platform/job-provider.js';

const ctx = (over: Partial<ProjectSitesJobContext> = {}): ProjectSitesJobContext => ({
  tenantId: 'tenant-1',
  requestId: 'req-1',
  traceId: 'trace-1',
  idempotencyKey: 'idem-1',
  source: 'api',
  createdAt: '2026-06-20T00:00:00.000Z',
  ...over,
});

function fakeSender(): InngestSender & { sent: { name: string; id?: string; data: Record<string, unknown> }[] } {
  const sent: { name: string; id?: string; data: Record<string, unknown> }[] = [];
  return {
    sent,
    async send(event) {
      sent.push(event);
      return { ids: [event.id ?? 'generated'] };
    },
  };
}

describe('InngestJobProvider', () => {
  it('sends the mapped event with id = idempotencyKey (dedupe)', async () => {
    const sender = fakeSender();
    const provider = new InngestJobProvider(sender);
    const ref = await provider.start('notification-workflow', ctx(), { template: 'site.published' });

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].name).toBe('job/notification.requested');
    expect(sender.sent[0].id).toBe('idem-1');
    expect(ref).toMatchObject({ backend: 'inngest', status: 'queued', jobId: 'idem-1', kind: 'notification-workflow' });
  });

  it('threads the routed context into event data, payload included', async () => {
    const sender = fakeSender();
    await new InngestJobProvider(sender).start('lifecycle-email', ctx({ tenantId: 't9' }), { to: 'a@b.com' });
    const data = sender.sent[0].data as { payload: unknown; _ctx: { tenantId: string; traceId: string } };
    expect(data.payload).toEqual({ to: 'a@b.com' });
    expect(data._ctx.tenantId).toBe('t9');
    expect(data._ctx.traceId).toBe('trace-1');
    expect(sender.sent[0].name).toBe('job/email.requested');
  });

  it('refuses a kind that does not route to inngest', async () => {
    const provider = new InngestJobProvider(fakeSender());
    await expect(provider.start('site-generation', ctx())).rejects.toThrow(/not an inngest-routed job/);
  });

  it('validates context before sending (no send on bad context)', async () => {
    const sender = fakeSender();
    const provider = new InngestJobProvider(sender);
    await expect(provider.start('notification-workflow', ctx({ idempotencyKey: '' }))).rejects.toThrow();
    expect(sender.sent).toHaveLength(0);
  });

  it('getJobStatus returns null (status read elsewhere) and cancel is a no-op', async () => {
    const provider = new InngestJobProvider(fakeSender());
    expect(await provider.getJobStatus('idem-1')).toBeNull();
    await expect(provider.cancelJob('idem-1')).resolves.toBeUndefined();
  });
});
