import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminWebhooksComponent } from './webhooks.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';
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
  let confirmSpy: jasmine.Spy;

  function build(site: { id: string } | null, confirmResult = true): void {
    get = jasmine.createSpy('get').and.callFake((path: string) =>
      path.endsWith('/deliveries')
        ? of({ ok: true, deliveries: [{ id: 'd1', eventType: 'site.published', statusCode: 200, ok: true, attempt: 1, createdAt: '2026-06-02T00:00:00Z' }] })
        : of({ ok: true, endpoints: [{ id: 'e1', url: 'https://x.com/h', eventTypes: ['site.published'], enabled: true }] }),
    );
    post = jasmine.createSpy('post').and.returnValue(of({ ok: true, id: 'e2', secret: 'whsec_topsecret' }));
    del = jasmine.createSpy('delete').and.returnValue(of({ ok: true }));
    confirmSpy = jasmine.createSpy('confirm').and.resolveTo(confirmResult);
    TestBed.configureTestingModule({
      imports: [AdminWebhooksComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get, post, delete: del } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: ConfirmService, useValue: { confirm: confirmSpy } },
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

  it('a 404 (outbound_webhooks flag OFF) shows the calm cyan Feature-Flags gate, not a red error card', () => {
    const g = jasmine.createSpy('get').and.callFake((path: string) =>
      path.endsWith('/deliveries')
        ? of({ ok: true, deliveries: [] })
        : throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' })),
    );
    TestBed.configureTestingModule({
      imports: [AdminWebhooksComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: g, post: jasmine.createSpy('post'), delete: jasmine.createSpy('delete') } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: ConfirmService, useValue: { confirm: jasmine.createSpy('confirm') } },
        { provide: AdminStateService, useValue: { selectedSite: () => ({ id: 'site-1' }) } },
      ],
    });
    const fx = TestBed.createComponent(AdminWebhooksComponent);
    fx.detectChanges();
    const el = fx.nativeElement as HTMLElement;
    expect(fx.componentInstance.flagDisabled()).withContext('404 → flag-disabled').toBeTrue();
    const gate = el.querySelector('[data-testid="webhooks-flag-gate"]');
    expect(gate).withContext('calm cyan gate notice renders').toBeTruthy();
    expect(el.querySelector('[data-testid="webhooks-error"]')).withContext('no red error card on a permanent gate').toBeNull();
    expect((gate?.querySelector('a') as HTMLAnchorElement | null)?.getAttribute('href')).toBe('/admin/feature-flags');
  });

  it('shows the empty state with no selected site', () => {
    build(null);
    expect(q('[data-testid="webhooks-empty"]')).not.toBeNull();
    expect(q('[data-testid="webhooks-create-btn"]')).toBeNull();
  });

  it('lists the site endpoints + recent deliveries', () => {
    build({ id: 's1' });
    expect(get).toHaveBeenCalledWith('/sites/s1/webhooks', undefined, { silent: true });
    expect(get).toHaveBeenCalledWith('/sites/s1/webhooks/deliveries', undefined, { silent: true });
    expect(all('[data-testid="webhooks-row"]').length).toBe(1);
    expect(all('[data-testid="webhooks-delivery-row"]').length).toBe(1);
  });

  it('creates an endpoint and reveals the secret once', () => {
    build({ id: 's1' });
    fixture.componentInstance.urlModel.set('https://hooks.me/x');
    fixture.detectChanges(); // let the canSubmit()-gated button enable before clicking
    (q('[data-testid="webhooks-create-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(post).toHaveBeenCalledWith('/sites/s1/webhooks', { url: 'https://hooks.me/x', eventTypes: ['site.published'] });
    expect(q('[data-testid="webhooks-secret"]')?.textContent).toContain('whsec_topsecret');
  });

  // The signing secret is shown ONCE + 'won't be shown again' — manually selecting
  // a break-all <code> block to copy an unrecoverable secret is error-prone. A
  // Copy button must exist + copy the exact secret to the clipboard.
  it('reveals a Copy button for the one-time secret + copies the exact value', async () => {
    build({ id: 's1' });
    const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fixture.componentInstance.createdSecret.set('whsec_topsecret');
    fixture.detectChanges();

    const copyBtn = q('[data-testid="webhooks-secret-copy"]') as HTMLButtonElement | null;
    expect(copyBtn).withContext('a one-time secret must have a Copy affordance').not.toBeNull();
    await fixture.componentInstance.copySecret();
    expect(writeText).toHaveBeenCalledWith('whsec_topsecret');
    expect(fixture.componentInstance.secretCopied()).toBeTrue();
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

  it('deletes an endpoint after confirmation and reloads', async () => {
    build({ id: 's1' }); // confirm resolves true
    const before = get.calls.count();
    await fixture.componentInstance.remove('e1', 'https://x.com/h');
    expect(confirmSpy).toHaveBeenCalled(); // destructive action is confirmed first
    expect(del).toHaveBeenCalledWith('/sites/s1/webhooks/e1', { silent: true }); // {silent}: own error toast, no generic double-toast
    expect(get.calls.count()).toBeGreaterThan(before); // reloaded after delete
  });

  it('does NOT delete when the confirm is cancelled', async () => {
    build({ id: 's1' }, false); // confirm resolves false (operator cancels)
    await fixture.componentInstance.remove('e1', 'https://x.com/h');
    expect(confirmSpy).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('loads once the selected site resolves after mount (reactive, not just at construct)', () => {
    const siteSig = signal<{ id: string } | null>(null);
    const g = jasmine.createSpy('get').and.callFake((p: string) =>
      p.endsWith('/deliveries') ? of({ ok: true, deliveries: [] }) : of({ ok: true, endpoints: [] }),
    );
    TestBed.configureTestingModule({
      imports: [AdminWebhooksComponent],
      providers: [
        provideRouter([]),
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
    expect(g).toHaveBeenCalledWith('/sites/s9/webhooks', undefined, { silent: true });
  });

  it('surfaces a not-available error', () => {
    build({ id: 's1' });
    get.and.returnValue(throwError(() => ({ error: {} })));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(q('[data-testid="webhooks-error"]')).not.toBeNull();
  });

  it('a transient 500 → retryable error rendered via the gold-standard error card + Retry', () => {
    build({ id: 's1' });
    get.and.returnValue(throwError(() => ({ status: 500 })));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.componentInstance.errorRetryable()).toBeTrue();
    // The transient failure now uses the shared <app-error-card> (Retry + a
    // copyable support reference) instead of a bare banner.
    expect(q('app-error-card')).withContext('shared error-card primitive').not.toBeNull();
    expect(q('[data-testid="error-retry"]')).withContext('Retry on the card').not.toBeNull();
  });

  it('surfaces the worker request_id as a copyable support reference on a transient failure', () => {
    build({ id: 's1' });
    get.and.returnValue(throwError(() => ({ status: 500, error: { error: { request_id: 'req_abc123' } } })));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.componentInstance.loadErrorRef()).toBe('req_abc123');
    expect(q('[data-testid="error-correlation"]')?.textContent).withContext('reference shown for support').toContain('req_abc123');
  });

  it('a 404 (flag OFF) → calm cyan flag-gate, NOT a red error card (retrying cannot help)', () => {
    build({ id: 's1' });
    get.and.returnValue(throwError(() => ({ status: 404 })));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.componentInstance.flagDisabled()).withContext('404 → flag-disabled').toBeTrue();
    expect(fixture.componentInstance.error()).withContext('gate is not a red error').toBeNull();
    expect(q('[data-testid="webhooks-flag-gate"]')).withContext('calm cyan gate renders').not.toBeNull();
    expect(q('[data-testid="webhooks-error"]')).withContext('no red error card / Retry on a permanent gate').toBeNull();
  });

  it('a load error SUPPRESSES the empty state (no error + "No webhook endpoints" shown together)', () => {
    build({ id: 's1' });
    get.and.returnValue(throwError(() => ({ status: 500 })));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(q('[data-testid="webhooks-error"]')).not.toBeNull();
    expect(q('app-empty-state')).withContext('the error owns the display — no double "No endpoints"').toBeNull();
  });

  // ── Create input validation (security/reliability) ────────────────────────
  // A webhook endpoint is called server-side, so a junk / http / internal URL
  // is an SSRF-adjacent footgun. Bad input must be rejected client-side with a
  // useful toast and NEVER reach the API; a valid https URL submits once.
  const toastErrSpy = (): jasmine.Spy => TestBed.inject(ToastService).error as jasmine.Spy;

  it('rejects a non-URL string — toasts an error and does NOT POST', () => {
    build({ id: 's1' });
    fixture.componentInstance.urlModel.set('notaurl');
    fixture.componentInstance.create();
    expect(post).not.toHaveBeenCalled();
    expect(toastErrSpy()).toHaveBeenCalled();
  });

  it('rejects a non-https (http://) URL — webhook targets must be https', () => {
    build({ id: 's1' });
    fixture.componentInstance.urlModel.set('http://hooks.example.com/x');
    fixture.componentInstance.create();
    expect(post).not.toHaveBeenCalled();
    expect(toastErrSpy()).toHaveBeenCalled();
  });

  it('rejects a hostname with no dot (e.g. https://localhost — internal target)', () => {
    build({ id: 's1' });
    fixture.componentInstance.urlModel.set('https://localhost');
    fixture.componentInstance.create();
    expect(post).not.toHaveBeenCalled();
    expect(toastErrSpy()).toHaveBeenCalled();
  });

  it('rejects when no events are selected', () => {
    build({ id: 's1' });
    fixture.componentInstance.urlModel.set('https://hooks.yourapp.com/projectsites');
    fixture.componentInstance.selected.set([]);
    fixture.componentInstance.create();
    expect(post).not.toHaveBeenCalled();
    expect(toastErrSpy()).toHaveBeenCalled();
  });

  it('accepts a well-formed https URL — POSTs exactly once with the trimmed URL', () => {
    build({ id: 's1' });
    fixture.componentInstance.urlModel.set('  https://hooks.yourapp.com/projectsites  ');
    fixture.componentInstance.selected.set(['site.published']);
    fixture.componentInstance.create();
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.calls.mostRecent().args as [string, { url: string; eventTypes: string[] }];
    expect(url).toBe('/sites/s1/webhooks');
    expect(body.url).toBe('https://hooks.yourapp.com/projectsites'); // trimmed
  });

  it('canSubmit() gates the button — false for a bad URL, true for a valid one', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.selected.set(['site.published']);
    c.urlModel.set('ftp://x');
    expect(c.canSubmit()).toBe(false);
    c.urlModel.set('https://hooks.yourapp.com/x');
    expect(c.canSubmit()).toBe(true);
    c.selected.set([]); // valid URL but no events
    expect(c.canSubmit()).toBe(false);
  });

  it('urlInvalid() is true only for a non-empty value that is not a valid https URL', () => {
    build({ id: 's1' });
    const c = fixture.componentInstance;
    c.urlModel.set('');
    expect(c.urlInvalid()).toBe(false); // empty → incomplete, not "invalid"
    c.urlModel.set('http://x');
    expect(c.urlInvalid()).toBe(true);
    c.urlModel.set('https://hooks.yourapp.com/x');
    expect(c.urlInvalid()).toBe(false);
  });

  it('renders the event checkboxes through Spartan hlmCheckbox (cyan accent + focus ring)', () => {
    build({ id: 's1' });
    const boxes = all('input[type=checkbox][hlmCheckbox]');
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => !b.className.includes('accent-primary'))).toBeTrue();
  });

  it('renders a shimmering skeleton (not bare "Loading…" text) while loading', () => {
    build({ id: 's1' });
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    expect(q('app-skeleton')).withContext('uses the reusable skeleton primitive').not.toBeNull();
    expect(host.textContent ?? '').not.toContain('Loading endpoints…');
  });

  it('renders the rich app-empty-state (not bare text) when there are no endpoints', () => {
    build({ id: 's1' });
    fixture.componentInstance.endpoints.set([]);
    fixture.detectChanges();
    expect(q('app-empty-state')).withContext('uses the reusable empty-state primitive').not.toBeNull();
  });
});

describe('AdminWebhooksComponent (public-host URL validation)', () => {
  let fx: import('@angular/core/testing').ComponentFixture<AdminWebhooksComponent>;
  afterEach(() => TestBed.resetTestingModule());

  function mk(): AdminWebhooksComponent {
    TestBed.configureTestingModule({
      imports: [AdminWebhooksComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { get: () => of({ ok: true, endpoints: [] }), post: () => of({ ok: true }), delete: () => of({ ok: true }) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: AdminStateService, useValue: { selectedSite: () => ({ id: 's1' }) } },
      ],
    });
    fx = TestBed.createComponent(AdminWebhooksComponent);
    fx.detectChanges();
    return fx.componentInstance;
  }

  it('flags private / link-local / metadata IP webhook URLs invalid (the "public hostname" promise)', () => {
    const c = mk();
    for (const url of [
      'https://127.0.0.1/h', 'https://10.0.0.1/h', 'https://192.168.0.1/h',
      'https://172.20.1.1/h', 'https://169.254.169.254/meta', 'https://api.internal/h',
    ]) {
      c.urlModel.set(url);
      expect(c.urlInvalid()).withContext(url).toBeTrue();
    }
    c.urlModel.set('https://hooks.example.com/projectsites');
    expect(c.urlInvalid()).withContext('public host valid').toBeFalse();
  });
});
