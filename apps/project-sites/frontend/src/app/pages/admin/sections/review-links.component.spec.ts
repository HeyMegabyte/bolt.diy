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
    expect(get).toHaveBeenCalledWith('/sites/s1/review-links');
    expect(all('[data-testid="review-links-row"]').length).toBe(1);
    expect(q('[data-testid="review-links-status"]')?.textContent?.trim()).toBe('pending');
  });

  it('creates a link and reveals it', () => {
    build({ id: 's1' });
    (q('[data-testid="review-links-create-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(post).toHaveBeenCalledWith('/sites/s1/review-links', {});
    expect(q('[data-testid="review-links-created"]')?.textContent).toContain('/review/r2');
  });

  it('loads reactively when the site resolves after mount (deep-link)', () => {
    build(null);
    expect(get).not.toHaveBeenCalled();

    selectedSite.set({ id: 'deep' });
    fixture.detectChanges();

    expect(get).toHaveBeenCalledWith('/sites/deep/review-links');
  });
});
