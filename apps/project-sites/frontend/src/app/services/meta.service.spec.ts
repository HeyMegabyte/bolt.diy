import { TestBed } from '@angular/core/testing';
import { Title, Meta } from '@angular/platform-browser';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { MetaService } from './meta.service';

/**
 * Per-route SEO/social contract for MetaService. Every route must get its OWN
 * title + a route-accurate canonical/og:url (the historical bug: WebPage/canonical
 * were hardcoded to the homepage on every route), plus the branded 1200×630 OG
 * card. updateMeta() is the apply step; we drive it directly + assert the
 * Title/Meta/canonical writes.
 */
type Testable = { updateMeta(page: { title: string; description: string }, path: string): void };

function setup(): { svc: Testable; setTitle: jasmine.Spy; updateTag: jasmine.Spy } {
  const setTitle = jasmine.createSpy('setTitle');
  const updateTag = jasmine.createSpy('updateTag');
  TestBed.configureTestingModule({
    providers: [
      MetaService,
      { provide: Title, useValue: { setTitle } },
      { provide: Meta, useValue: { updateTag } },
      { provide: Router, useValue: { events: new Subject() } },
      { provide: ActivatedRoute, useValue: { url: new Subject(), firstChild: null } },
    ],
  });
  return { svc: TestBed.inject(MetaService) as unknown as Testable, setTitle, updateTag };
}

/** Last value updateTag received for a given og/twitter/name selector. */
function tagContent(spy: jasmine.Spy, match: Record<string, string>): string | undefined {
  const key = Object.keys(match)[0];
  const call = [...spy.calls.allArgs()].reverse().find((a) => (a[0] as Record<string, string>)?.[key] === match[key]);
  return call ? (call[0] as { content: string }).content : undefined;
}

describe('MetaService (per-route SEO/social tags)', () => {
  let canonical: HTMLLinkElement;
  beforeEach(() => {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = 'https://projectsites.dev/';
    document.head.appendChild(canonical);
  });
  afterEach(() => {
    canonical.remove();
    TestBed.resetTestingModule();
  });

  it('sets the page-specific <title>', () => {
    const { svc, setTitle } = setup();
    svc.updateMeta({ title: 'Roadmap · ProjectSites', description: 'what we ship next' }, 'roadmap');
    expect(setTitle).toHaveBeenCalledWith('Roadmap · ProjectSites');
  });

  it('writes a route-accurate canonical + og:url (NOT the homepage)', () => {
    const { svc, updateTag } = setup();
    svc.updateMeta({ title: 'Roadmap', description: 'd' }, 'roadmap');
    expect(canonical.href).toBe('https://projectsites.dev/roadmap');
    expect(tagContent(updateTag, { property: 'og:url' })).toBe('https://projectsites.dev/roadmap');
  });

  it('mirrors title/description into og + twitter tags', () => {
    const { svc, updateTag } = setup();
    svc.updateMeta({ title: 'T', description: 'D' }, 'press');
    expect(tagContent(updateTag, { property: 'og:title' })).toBe('T');
    expect(tagContent(updateTag, { property: 'og:description' })).toBe('D');
    expect(tagContent(updateTag, { name: 'twitter:title' })).toBe('T');
    expect(tagContent(updateTag, { name: 'twitter:description' })).toBe('D');
  });

  it('uses the branded 1200×630 OG card', () => {
    const { svc, updateTag } = setup();
    svc.updateMeta({ title: 'T', description: 'D' }, '');
    expect(tagContent(updateTag, { property: 'og:image' })).toContain('og-image');
    expect(tagContent(updateTag, { property: 'og:image:width' })).toBe('1200');
    expect(tagContent(updateTag, { property: 'og:image:height' })).toBe('630');
  });

  it('homepage path yields the bare base canonical', () => {
    const { svc } = setup();
    svc.updateMeta({ title: 'Home', description: 'd' }, '');
    expect(canonical.href).toBe('https://projectsites.dev/');
  });
});
