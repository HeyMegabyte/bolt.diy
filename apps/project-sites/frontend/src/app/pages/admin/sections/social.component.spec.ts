import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AdminSocialComponent } from './social.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the P0 site-reactive-load class-bug fix for the Social section.
 * accounts + posts are site-scoped and there is NO data-refresh timer (the
 * only setInterval is the per-OAuth popup poll), so on a deep-link — where the
 * site resolves AFTER mount — the constructor effect (not ngOnInit-once) must
 * fire loadAccounts + loadPosts the instant selectedSite() resolves.
 */
describe('AdminSocialComponent (site-reactive load)', () => {
  let fixture: ComponentFixture<AdminSocialComponent>;
  let selectedSite: WritableSignal<{ id: string } | null>;
  let get: jasmine.Spy;

  const accountsCalls = (): unknown[][] =>
    get.calls.allArgs().filter((a) => a[0] === '/social/accounts');
  const postsCalls = (): unknown[][] =>
    get.calls.allArgs().filter((a) => a[0] === '/social/posts');

  function build(initial: { id: string } | null): void {
    selectedSite = signal<{ id: string } | null>(initial);
    get = jasmine.createSpy('get').and.callFake((path: string) => {
      if (path === '/social/auto-pilot/config') return of({ data: null });
      return of({ data: [] });
    });
    TestBed.configureTestingModule({
      imports: [AdminSocialComponent],
      providers: [
        { provide: ApiService, useValue: { get, post: jasmine.createSpy('post').and.returnValue(of({ data: {} })), delete: jasmine.createSpy('delete').and.returnValue(of({})) } },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminSocialComponent);
    fixture.detectChanges(); // ngOnInit + first effect flush
  }

  afterEach(() => TestBed.resetTestingModule());

  it('does NOT load accounts/posts on mount when no site is selected (deep-link)', () => {
    build(null);
    expect(accountsCalls().length).toBe(0);
    expect(postsCalls().length).toBe(0);
    expect(get).toHaveBeenCalledWith('/social/auto-pilot/config'); // org-level still loads
  });

  it('loads accounts + posts the instant the site resolves after mount', () => {
    build(null);
    expect(accountsCalls().length).toBe(0);

    selectedSite.set({ id: 'site-deep' });
    fixture.detectChanges(); // flush the constructor effect — NOT a timer

    expect(get).toHaveBeenCalledWith('/social/accounts', { site_id: 'site-deep' });
    expect(postsCalls().length).toBe(1);
    expect(postsCalls()[0][1]).toEqual({ site_id: 'site-deep' });
  });

  it('re-loads when the operator switches sites', () => {
    build({ id: 'site-a' });
    expect(get).toHaveBeenCalledWith('/social/accounts', { site_id: 'site-a' });

    selectedSite.set({ id: 'site-b' });
    fixture.detectChanges();

    expect(get).toHaveBeenCalledWith('/social/accounts', { site_id: 'site-b' });
  });
});
