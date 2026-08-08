import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { SystemServicesComponent } from './system-services.component';
import { ApiService } from '../../../services/api.service';

/**
 * System Services operator catalog. Verifies it loads the platform service registry
 * (GET /api/super-admin/services), sorts live-first, derives count chips, strips the
 * wildcard from domains, and surfaces a retry-able error — ApiService mocked (no HTTP).
 */
describe('SystemServicesComponent', () => {
  let api: jasmine.SpyObj<ApiService>;

  const payload = {
    services: [
      { id: 'p1', name: 'Planned One', category: 'webhooks', runtime: 'cloudflare-container', status: 'planned', access: 'internal-access' },
      { id: 'a1', name: 'Auth', domain: 'auth.projectsites.dev', category: 'auth', runtime: 'cloudflare-container', status: 'production', access: 'public' },
      { id: 's1', name: 'Serving', domain: '*.projectsites.dev', category: 'edge', runtime: 'cloudflare-worker', status: 'production', access: 'public' },
    ],
    counts: { total: 3, production: 2, integrated: 0, scaffolded: 0, planned: 1 },
  };

  function make(): SystemServicesComponent {
    return TestBed.runInInjectionContext(() => new SystemServicesComponent());
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of(payload));
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }],
    });
  });

  it('loads the service catalog on init', () => {
    const c = make();
    c.ngOnInit();
    expect(api.get).toHaveBeenCalledWith('/super-admin/services');
    expect(c.services().length).toBe(3);
    expect(c.loading()).toBe(false);
    expect(c.loadError()).toBeNull();
  });

  it('sorts production before planned', () => {
    const c = make();
    c.ngOnInit();
    expect(c.services()[0].status).toBe('production');
    expect(c.services()[c.services().length - 1].status).toBe('planned');
  });

  it('derives count chips with non-zero values only', () => {
    const c = make();
    c.ngOnInit();
    const chips = c.countChips();
    expect(chips.find((x) => x.key === 'production')?.value).toBe(2);
    expect(chips.some((x) => x.key === 'integrated')).toBe(false);
  });

  it('strips the wildcard prefix from a domain for the href', () => {
    const c = make();
    expect(c.cleanDomain('*.projectsites.dev')).toBe('projectsites.dev');
    expect(c.cleanDomain('auth.projectsites.dev')).toBe('auth.projectsites.dev');
  });

  it('surfaces a retry-able error when the fetch fails', () => {
    api.get.and.returnValue(throwError(() => new Error('boom')));
    const c = make();
    c.ngOnInit();
    expect(c.loadError()).toBe('Could not load the service catalog.');
    expect(c.loading()).toBe(false);
  });

  it('maps status to a brand status badge class', () => {
    const c = make();
    expect(c.badgeClass('production')).toContain('emerald');
    expect(c.badgeClass('integrated')).toContain('primary');
    expect(c.badgeClass('planned')).toContain('text-text-secondary');
  });

  it('merges live probe status onto services that have a probe (billing-stripe → stripe)', () => {
    const catalog = {
      services: [
        { id: 'billing-stripe', name: 'Stripe', category: 'billing', runtime: 'saas', status: 'production', access: 'public' },
        { id: 'data-d1', name: 'D1', category: 'data', runtime: 'cloudflare-d1', status: 'production', access: 'internal' },
      ],
      counts: { total: 2, production: 2 },
    };
    const health = { integrations: [{ integration: 'stripe', status: 'healthy' }] };
    api.get.and.callFake(<T,>(path: string) =>
      of((path === '/integrations/health' ? health : catalog) as T),
    );
    const c = make();
    c.ngOnInit();
    expect(api.get).toHaveBeenCalledWith('/integrations/health');
    expect(c.liveStatusFor('billing-stripe')).toBe('healthy'); // namespaced id → bare probe → merged
    expect(c.liveStatusFor('data-d1')).toBeNull(); // pure data store — no probe
  });

  it('a live-probe failure NEVER blanks the catalog (best-effort merge)', () => {
    api.get.and.callFake(<T,>(path: string) =>
      path === '/integrations/health'
        ? throwError(() => new Error('probe down'))
        : of(payload as T),
    );
    const c = make();
    c.ngOnInit();
    expect(c.services().length).toBe(3); // catalog still loads
    expect(c.loadError()).toBeNull();
    expect(c.liveStatusFor('a1')).toBeNull(); // no live data, but no crash
  });

  it('maps live health to dot + label classes', () => {
    const c = make();
    expect(c.healthDotClass('healthy')).toContain('emerald');
    expect(c.healthDotClass('degraded')).toContain('amber');
    expect(c.healthDotClass('failing')).toContain('red');
    expect(c.healthLabelClass('failing')).toContain('red');
    expect(c.healthLabelClass('unknown')).toContain('text-text-secondary');
  });

  it('healthSummary tallies probed integrations worst-first and excludes removed', () => {
    const health = {
      integrations: [
        { integration: 'stripe', status: 'healthy' },
        { integration: 'langfuse', status: 'healthy' },
        { integration: 'twenty', status: 'failing' },
        { integration: 'unkey', status: 'unknown' },
        { integration: 'nango', status: 'removed' }, // decommissioned — excluded
      ],
    };
    api.get.and.callFake(<T,>(path: string) =>
      of((path === '/integrations/health' ? health : payload) as T),
    );
    const c = make();
    c.ngOnInit();
    const summary = c.healthSummary();
    // worst-first order (failing → degraded → unknown → healthy), removed dropped.
    // 'removed' is absent from the keys — the type itself excludes it (the .toEqual
    // above is the assertion; TS proves 'removed' can never appear in the summary).
    expect(summary.map((s) => s.key)).toEqual(['failing', 'unknown', 'healthy']);
    expect(summary.find((s) => s.key === 'healthy')?.value).toBe(2);
    expect(summary.find((s) => s.key === 'failing')?.value).toBe(1);
  });
});
