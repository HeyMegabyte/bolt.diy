import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminWebhooksComponent } from './webhooks.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the Outbound Webhooks (#10) admin section: empty state w/o site, list
 * renders, create posts {url, eventTypes} + reveals the secret once, delete
 * calls the API + reloads.
 */
describe('AdminWebhooksComponent', () => {
  let fixture: ComponentFixture<AdminWebhooksComponent>;
  let host: HTMLElement;
  let get: jasmine.Spy;
  let post: jasmine.Spy;
  let del: jasmine.Spy;

  function build(site: { id: string } | null): void {
    get = jasmine.createSpy('get').and.callFake((path: string) =>
      path.endsWith('/deliveries')
        ? of({ ok: true, deliveries: [{ id: 'd1', eventType: 'site.published', statusCode: 200, ok: true, attempt: 1, createdAt: '2026-06-02T00:00:00Z' }] })
        : of({ ok: true, endpoints: [{ id: 'e1', url: 'https://x.com/h', eventTypes: ['site.published'], enabled: true }] }),
    );
    post = jasmine.createSpy('post').and.returnValue(of({ ok: true, id: 'e2', secret: 'whsec_topsecret' }));
    del = jasmine.createSpy('delete').and.returnValue(of({ ok: true }));
    TestBed.configureTestingModule({
      imports: [AdminWebhooksComponent],
      providers: [
        { provide: ApiService, useValue: { get, post, delete: del } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: AdminStateService, useValue: { selectedSite: () => site } },
      ],
    });
    fixture = TestBed.createComponent(AdminWebhooksComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);
  const all = (sel: string): HTMLElement[] => Array.from(host.querySelectorAll(sel));
  afterEach(() => TestBed.resetTestingModule());

  it('shows the empty state with no selected site', () => {
    build(null);
    expect(q('[data-testid="webhooks-empty"]')).not.toBeNull();
    expect(q('[data-testid="webhooks-create-btn"]')).toBeNull();
  });

  it('lists the site endpoints + recent deliveries', () => {
    build({ id: 's1' });
    expect(get).toHaveBeenCalledWith('/sites/s1/webhooks');
    expect(get).toHaveBeenCalledWith('/sites/s1/webhooks/deliveries');
    expect(all('[data-testid="webhooks-row"]').length).toBe(1);
    expect(all('[data-testid="webhooks-delivery-row"]').length).toBe(1);
  });

  it('creates an endpoint and reveals the secret once', () => {
    build({ id: 's1' });
    fixture.componentInstance.urlModel.set('https://hooks.me/x');
    (q('[data-testid="webhooks-create-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(post).toHaveBeenCalledWith('/sites/s1/webhooks', { url: 'https://hooks.me/x', eventTypes: ['site.published'] });
    expect(q('[data-testid="webhooks-secret"]')?.textContent).toContain('whsec_topsecret');
  });

  it('toggles event selection', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    expect(c.selected()).toEqual(['site.published']);
    c.toggleEvent('form.submitted');
    expect(c.selected()).toContain('form.submitted');
    c.toggleEvent('site.published');
    expect(c.selected()).not.toContain('site.published');
  });

  it('deletes an endpoint and reloads', () => {
    build({ id: 's1' });
    const before = get.calls.count();
    (q('[data-testid="webhooks-delete"]') as HTMLButtonElement).click();
    expect(del).toHaveBeenCalledWith('/sites/s1/webhooks/e1');
    expect(get.calls.count()).toBeGreaterThan(before); // reloaded after delete
  });

  it('loads once the selected site resolves after mount (reactive, not just at construct)', () => {
    const siteSig = signal<{ id: string } | null>(null);
    const g = jasmine.createSpy('get').and.callFake((p: string) =>
      p.endsWith('/deliveries') ? of({ ok: true, deliveries: [] }) : of({ ok: true, endpoints: [] }),
    );
    TestBed.configureTestingModule({
      imports: [AdminWebhooksComponent],
      providers: [
        { provide: ApiService, useValue: { get: g, post: jasmine.createSpy('post'), delete: jasmine.createSpy('delete') } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('e'), success: jasmine.createSpy('s') } },
        { provide: AdminStateService, useValue: { selectedSite: siteSig } },
      ],
    });
    const fx = TestBed.createComponent(AdminWebhooksComponent);
    fx.detectChanges();
    expect(g).not.toHaveBeenCalled(); // no site yet

    siteSig.set({ id: 's9' });
    fx.detectChanges();
    expect(g).toHaveBeenCalledWith('/sites/s9/webhooks');
  });

  it('surfaces a not-available error', () => {
    build({ id: 's1' });
    get.and.returnValue(throwError(() => ({ error: {} })));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(q('[data-testid="webhooks-error"]')).not.toBeNull();
  });
});
