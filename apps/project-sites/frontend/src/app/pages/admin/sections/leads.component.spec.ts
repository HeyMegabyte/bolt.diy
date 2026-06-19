import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AdminLeadsComponent } from './leads.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';

/**
 * #9 lead-scanner admin console. Verifies the component's API wiring against the
 * worker surface (GET /api/admin/leads · POST .../scan · POST .../:id/claim-link)
 * with ApiService + ToastService mocked — no HTTP, no clipboard side effects.
 */
describe('AdminLeadsComponent', () => {
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  const lead = {
    leadId: 'l1',
    businessName: 'Acme Roofing',
    hasWebsite: false,
    leadScore: 88,
    priority: true,
    email: null,
    emailStatus: null,
    source: 'google_places',
    createdAt: '2026-06-19T00:00:00Z',
  };

  function make(): AdminLeadsComponent {
    return TestBed.runInInjectionContext(() => new AdminLeadsComponent());
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'info', 'error']);
    api.get.and.returnValue(of({ leads: [lead], count: 1 }));
    api.post.and.returnValue(of({ summary: { scanned: 3, created: 2 } }));
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  it('loads leads on init (no-website filter on by default)', () => {
    const c = make();
    c.ngOnInit();
    expect(api.get).toHaveBeenCalledWith('/admin/leads?onlyNoWebsite=true');
    expect(c.leads().length).toBe(1);
    expect(c.loading()).toBe(false);
  });

  it('drops the filter param when no-website-only is off', () => {
    const c = make();
    c.onlyNoWebsite.set(false);
    c.loadLeads();
    expect(api.get).toHaveBeenCalledWith('/admin/leads');
  });

  it('sets loadError on a failed list fetch (never throws)', () => {
    api.get.and.returnValue(throwError(() => new Error('boom')));
    const c = make();
    c.loadLeads();
    expect(c.loadError()).toBe(true);
    expect(c.loading()).toBe(false);
  });

  it('scan posts the query + filter, records the summary, and reloads', () => {
    const c = make();
    c.query = 'roofers newark nj';
    c.scan();
    expect(api.post).toHaveBeenCalledWith('/admin/leads/scan', {
      query: 'roofers newark nj',
      onlyNoWebsite: true,
    });
    expect(c.lastScan()).toEqual({ scanned: 3, created: 2 });
    expect(toast.success).toHaveBeenCalled();
    // reload fired (get called again after the post)
    expect(api.get).toHaveBeenCalled();
    expect(c.scanning()).toBe(false);
  });

  it('does not scan a too-short or empty query', () => {
    const c = make();
    c.query = 'x';
    c.scan();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('copyClaimLink mints the link and writes it to the clipboard', async () => {
    const writeText = jasmine.createSpy('writeText').and.resolveTo();
    // jsdom/headless may not define clipboard — define a stub for the test.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    api.post.and.returnValue(
      of({ token: 'abc12345', claimUrl: 'https://projectsites.dev/api/claim/abc12345' }),
    );
    const c = make();
    c.copyClaimLink(lead);
    expect(api.post).toHaveBeenCalledWith('/admin/leads/l1/claim-link', {});
    expect(c.isCopying('l1')).toBe(false); // cleared synchronously on next
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('https://projectsites.dev/api/claim/abc12345');
  });

  it('clears the per-row busy guard on a mint error', () => {
    api.post.and.returnValue(throwError(() => new Error('nope')));
    const c = make();
    c.copyClaimLink(lead);
    expect(c.isCopying('l1')).toBe(false);
  });
});
