/**
 * The canonical `site.published` golden-path event shape (§9). Locks the event
 * contract the embedded-bolt publish route emits onto the durable bus, plus the
 * (siteId, version) idempotency scope so a re-publish of one version dedupes.
 */
import {
  buildSitePublishedEvent,
  sitePublishedScope,
} from '../services/site_publish_event.js';
import { EVENT_TYPES } from '../services/event_bus.js';

describe('buildSitePublishedEvent', () => {
  const base = {
    siteId: 'site-1',
    orgId: 'org-1',
    slug: 'acme',
    version: '2026-06-20T17-00-00-000Z',
    url: 'https://acme.projectsites.dev',
    source: 'bolt-embedded' as const,
  };

  it('builds a valid site.published event with tenant + data', () => {
    const ev = buildSitePublishedEvent({ ...base, userId: 'user-1', requestId: 'req-1' });
    expect(EVENT_TYPES).toContain(ev.type); // type is a real bus event
    expect(ev.type).toBe('site.published');
    expect(ev.producer).toBe('worker');
    expect(ev.tenantId).toBe('org-1');
    expect(ev.siteId).toBe('site-1');
    expect(ev.userId).toBe('user-1');
    expect(ev.requestId).toBe('req-1');
    expect(ev.traceId).toBe('req-1'); // requestId wins as traceId
    expect(ev.data).toEqual({
      slug: 'acme',
      version: base.version,
      url: base.url,
      source: 'bolt-embedded',
    });
  });

  it('falls back to siteId as traceId and omits userId/requestId when absent', () => {
    const ev = buildSitePublishedEvent(base);
    expect(ev.traceId).toBe('site-1');
    expect('userId' in ev).toBe(false);
    expect('requestId' in ev).toBe(false);
  });

  it('omits userId when explicitly null (anonymous publish)', () => {
    const ev = buildSitePublishedEvent({ ...base, userId: null });
    expect('userId' in ev).toBe(false);
  });
});

describe('sitePublishedScope', () => {
  it('scopes idempotency to (siteId, version) so each version emits once', () => {
    expect(sitePublishedScope('site-1', 'v2')).toEqual(['site-1', 'v2']);
    // a re-publish of the SAME version dedupes (same scope → same key);
    // a NEW version produces a distinct scope → a fresh event.
    expect(sitePublishedScope('site-1', 'v2')).not.toEqual(sitePublishedScope('site-1', 'v3'));
  });
});
