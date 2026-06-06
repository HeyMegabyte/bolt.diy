import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { AdminReviewLinksComponent } from './review-links.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the Review Links (#4) admin section: empty state w/o site, list renders
 * with derived status, create posts then reveals the new link, and the load is
 * site-reactive (fires when selectedSite resolves after mount — deep-link).
 */
describe('AdminReviewLinksComponent', () => {
  let fixture: ComponentFixture<AdminReviewLinksComponent>;
  let host: HTMLElement;
  let selectedSite: WritableSignal<{ id: string } | null>;
  let get: jasmine.Spy;
  let post: jasmine.Spy;

  function build(site: { id: string } | null): void {
    selectedSite = signal<{ id: string } | null>(site);
    get = jasmine.createSpy('get').and.returnValue(
      of({ ok: true, links: [{ id: 'r1', status: 'pending', url: '/review/r1', expiresAt: '2026-12-31T00:00:00.000Z', usedAt: null }] }),
    );
    post = jasmine.createSpy('post').and.returnValue(of({ ok: true, id: 'r2', url: '/review/r2', expiresAt: '2027-01-01T00:00:00.000Z' }));
    TestBed.configureTestingModule({
      imports: [AdminReviewLinksComponent],
      providers: [
        { provide: ApiService, useValue: { get, post } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminReviewLinksComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);
  const all = (sel: string): HTMLElement[] => Array.from(host.querySelectorAll(sel));
  afterEach(() => TestBed.resetTestingModule());

  it('shows the empty state and does not fetch without a selected site', () => {
    build(null);
    expect(q('[data-testid="review-links-empty"]')).not.toBeNull();
    expect(q('[data-testid="review-links-create-btn"]')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('lists the site review links with their status', () => {
    build({ id: 's1' });
    // {silent:true} — the component owns the inline error banner + Retry, so the
    // generic ApiService "Can't reach the server" toast must NOT also fire (no double-toast).
    expect(get).toHaveBeenCalledWith('/sites/s1/review-links', undefined, { silent: true });
    expect(all('[data-testid="review-links-row"]').length).toBe(1);
    expect(q('[data-testid="review-links-status"]')?.textContent?.trim()).toBe('pending');
  });

  // The link URL is truncated (.truncate) — it MUST carry a title so the full
  // value is readable on hover when clipped (it's an opaque identifier otherwise).
  it('gives the truncated link URL a hover title (readable when clipped)', () => {
    build({ id: 's1' });
    const code = q('[data-testid="review-links-row"] code') as HTMLElement;
    expect(code).withContext('link URL code cell').not.toBeNull();
    expect(code.classList.contains('truncate')).withContext('is truncated').toBeTrue();
    expect(code.getAttribute('title')).withContext('hover title = full URL').toBe('/review/r1');
  });

  it('creates a link and reveals it', () => {
    build({ id: 's1' });
    (q('[data-testid="review-links-create-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(post).toHaveBeenCalledWith('/sites/s1/review-links', {}, { silent: true });
    expect(q('[data-testid="review-links-created"]')?.textContent).toContain('/review/r2');
  });

  it('loads reactively when the site resolves after mount (deep-link)', () => {
    build(null);
    expect(get).not.toHaveBeenCalled();

    selectedSite.set({ id: 'deep' });
    fixture.detectChanges();

    expect(get).toHaveBeenCalledWith('/sites/deep/review-links', undefined, { silent: true });
  });

  it('renders a shimmering skeleton (not bare "Loading…" text) while loading', () => {
    build({ id: 's1' });
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();
    expect(q('app-skeleton')).withContext('uses the reusable skeleton primitive').not.toBeNull();
    expect(host.textContent ?? '').not.toContain('Loading review links…');
  });

  it('renders the rich app-empty-state (not bare text) when there are no review links', () => {
    build({ id: 's1' });
    fixture.componentInstance.links.set([]);
    fixture.detectChanges();
    expect(q('app-empty-state')).withContext('uses the reusable empty-state primitive').not.toBeNull();
  });
});

/**
 * Load-error honesty: a TRANSIENT failure (500/network) must read as retryable
 * (with a Retry button), NOT as a permanent "not available for this site"
 * feature-gate. A genuine 404 IS a feature-gate → no Retry (retrying won't help).
 */
describe('AdminReviewLinksComponent (load-error retryability)', () => {
  function buildErr(getSpy: jasmine.Spy): ComponentFixture<AdminReviewLinksComponent> {
    TestBed.configureTestingModule({
      imports: [AdminReviewLinksComponent],
      providers: [
        { provide: ApiService, useValue: { get: getSpy, post: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: AdminStateService, useValue: { selectedSite: signal<{ id: string } | null>({ id: 's1' }) } },
      ],
    });
    const fx = TestBed.createComponent(AdminReviewLinksComponent);
    fx.detectChanges();
    return fx;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('a transient 500 → retryable error rendered via the gold-standard error card + Retry', () => {
    const fx = buildErr(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    const c = fx.componentInstance;
    const el = fx.nativeElement as HTMLElement;
    expect(c.errorRetryable()).toBeTrue();
    // The transient failure now uses the shared <app-error-card> (Retry + a
    // copyable support reference) instead of a bare banner.
    expect(el.querySelector('app-error-card')).withContext('shared error-card primitive').not.toBeNull();
    expect(el.querySelector('[data-testid="error-retry"]')).withContext('Retry on the card').not.toBeNull();
  });

  it('surfaces the worker request_id as a copyable support reference on a transient failure', () => {
    const fx = buildErr(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500, error: { error: { request_id: 'req_rl99' } } }))));
    const el = fx.nativeElement as HTMLElement;
    expect(fx.componentInstance.loadErrorRef()).toBe('req_rl99');
    expect(el.querySelector('[data-testid="error-correlation"]')?.textContent).withContext('reference shown for support').toContain('req_rl99');
  });

  it('a 404 → a feature-gate message with NO Retry (retrying cannot help)', () => {
    const fx = buildErr(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 404 }))));
    const c = fx.componentInstance;
    expect(c.errorRetryable()).toBeFalse();
    expect(c.error()).toContain("aren't enabled");
    expect((fx.nativeElement as HTMLElement).querySelector('[data-testid="review-links-retry"]')).toBeNull();
  });

  it('a load error SUPPRESSES the empty state (no error + "No review links yet" together)', () => {
    const fx = buildErr(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="review-links-error"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="review-links-none"]')).withContext('error owns the display — no double empty state').toBeNull();
  });

  it('Retry re-issues the load + clears the error on success', () => {
    const get = jasmine.createSpy('get').and.returnValues(
      throwError(() => ({ status: 500 })),
      of({ ok: true, links: [] }),
    );
    const fx = buildErr(get);
    expect(fx.componentInstance.error()).not.toBeNull();
    fx.componentInstance.load();
    expect(fx.componentInstance.error()).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
