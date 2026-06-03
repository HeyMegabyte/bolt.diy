import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AdminAnalyticsComponent } from './analytics.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../services/toast.service';
import { PromptService } from '../../../services/prompt.service';
import { AdminStateService } from '../admin-state.service';

/**
 * Guards the P0 site-reactive-load class-bug fix for the Analytics section:
 * on a deep-link the selected site resolves AFTER mount, so the constructor
 * effect (not ngOnInit-once) must fire the analytics + URL fetch the instant
 * selectedSite() resolves — never leaving the panel empty until the 60s poll.
 */
describe('AdminAnalyticsComponent (site-reactive load)', () => {
  let fixture: ComponentFixture<AdminAnalyticsComponent>;
  let selectedSite: WritableSignal<{ id: string } | null>;
  let getAnalytics: jasmine.Spy;
  let listUrls: jasmine.Spy;
  let credStatus: jasmine.Spy;

  function build(initial: { id: string } | null): void {
    selectedSite = signal<{ id: string } | null>(initial);
    getAnalytics = jasmine.createSpy('getMultiUrlAnalytics').and.returnValue(of({ data: null }));
    listUrls = jasmine.createSpy('listSiteUrls').and.returnValue(of({ data: [] }));
    credStatus = jasmine.createSpy('getCloudflareCredentialStatus').and.returnValue(of({ data: null }));
    TestBed.configureTestingModule({
      imports: [AdminAnalyticsComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            getMultiUrlAnalytics: getAnalytics,
            listSiteUrls: listUrls,
            getCloudflareCredentialStatus: credStatus,
            addSiteUrl: jasmine.createSpy('addSiteUrl').and.returnValue(of({})),
          },
        },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error'), success: jasmine.createSpy('success') } },
        { provide: PromptService, useValue: { prompt: jasmine.createSpy('prompt').and.resolveTo(null) } },
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
        { provide: AdminStateService, useValue: { selectedSite } },
      ],
    });
    fixture = TestBed.createComponent(AdminAnalyticsComponent);
    fixture.detectChanges(); // ngOnInit + first effect flush
  }

  afterEach(() => TestBed.resetTestingModule());

  it('does NOT fetch analytics on mount when no site is selected (deep-link)', () => {
    build(null);
    expect(getAnalytics).not.toHaveBeenCalled();
    expect(credStatus).toHaveBeenCalled(); // org-level cred status still loads
  });

  it('fetches analytics the instant the site resolves after mount (no poll tick)', () => {
    build(null);
    expect(getAnalytics).not.toHaveBeenCalled();

    selectedSite.set({ id: 'site-deep-link' });
    fixture.detectChanges(); // flush the constructor effect — NOT the 60s timer

    expect(getAnalytics).toHaveBeenCalled();
    expect(getAnalytics.calls.mostRecent().args[0]).toBe('site-deep-link');
    expect(listUrls).toHaveBeenCalledWith('site-deep-link');
  });

  it('re-fetches when the operator switches sites', () => {
    build({ id: 'site-a' });
    expect(getAnalytics.calls.mostRecent().args[0]).toBe('site-a');

    selectedSite.set({ id: 'site-b' });
    fixture.detectChanges();

    expect(getAnalytics.calls.mostRecent().args[0]).toBe('site-b');
  });
});
