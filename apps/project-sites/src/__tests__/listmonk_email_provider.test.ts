/**
 * Convergence §42/ADR-0019 — ListmonkMarketingEmailProvider.
 *
 * Locks: subscriber upsert + campaign create/send + unsubscribe hit the right
 * listmonk endpoints with Basic auth, {ok:false} maps to a throw, and input is
 * validated — via an injected fetch (no network).
 */
import { ListmonkMarketingEmailProvider } from '../services/listmonk_email_provider.js';
import { EmailInputError } from '../platform/email.js';
import type { ListmonkConfig } from '../services/listmonk_client.js';

const cfg: ListmonkConfig = { baseUrl: 'https://mail.projectsites.dev', apiUser: 'admin', apiToken: 'tok' };

function fakeFetch(byUrl: (url: string) => { status: number; json?: unknown } = () => ({ status: 200, json: { data: { id: 7 } } })) {
  const calls: { url: string; method: string; auth?: string; body?: unknown }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: u, method: init?.method ?? 'GET', auth: h.Authorization, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const { status, json } = byUrl(u);
    return new Response(JSON.stringify(json ?? {}), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

describe('ListmonkMarketingEmailProvider', () => {
  it('upserts a subscriber via /api/subscribers with Basic auth', async () => {
    const f = fakeFetch();
    const r = await new ListmonkMarketingEmailProvider(cfg, f).upsertSubscriber({ email: 'a@b.com', attribs: { name: 'Al' } });
    expect(r).toEqual({ id: '7' });
    expect(f.calls[0].url).toBe('https://mail.projectsites.dev/api/subscribers');
    expect(f.calls[0].auth).toMatch(/^Basic /);
    expect((f.calls[0].body as { name: string }).name).toBe('Al');
  });

  it('creates + sends a campaign', async () => {
    const f = fakeFetch();
    const p = new ListmonkMarketingEmailProvider(cfg, f);
    const camp = await p.createCampaign({ name: 'June', subject: 'News', body: '<p>hi</p>', listIds: [1] });
    expect(camp.id).toBe('7');
    expect(f.calls[0].url).toBe('https://mail.projectsites.dev/api/campaigns');
    expect((f.calls[0].body as { type: string }).type).toBe('regular');

    const sent = await p.sendCampaign({ campaignId: '7' });
    expect(sent).toEqual({ id: '7', started: true });
    expect(f.calls[1].url).toBe('https://mail.projectsites.dev/api/campaigns/7/status');
    expect(f.calls[1].method).toBe('PUT');
  });

  it('unsubscribes via the blocklist query endpoint (email escaped)', async () => {
    const f = fakeFetch();
    await new ListmonkMarketingEmailProvider(cfg, f).unsubscribe({ email: "o'brien@b.com" });
    expect(f.calls[0].url).toBe('https://mail.projectsites.dev/api/subscribers/query/blocklist');
    expect((f.calls[0].body as { query: string }).query).toContain("o''brien@b.com");
  });

  it('maps a listmonk failure to a throw', async () => {
    const f = fakeFetch(() => ({ status: 500 }));
    await expect(new ListmonkMarketingEmailProvider(cfg, f).createCampaign({ name: 'x', subject: 'y', body: 'z' })).rejects.toThrow(/createCampaign failed/);
  });

  it('validates inputs (bad email, non-numeric campaignId)', async () => {
    const f = fakeFetch();
    const p = new ListmonkMarketingEmailProvider(cfg, f);
    await expect(p.upsertSubscriber({ email: 'bad' })).rejects.toBeInstanceOf(EmailInputError);
    await expect(p.sendCampaign({ campaignId: 'NaN' })).rejects.toBeInstanceOf(EmailInputError);
    expect(f.calls).toHaveLength(0);
  });
});
