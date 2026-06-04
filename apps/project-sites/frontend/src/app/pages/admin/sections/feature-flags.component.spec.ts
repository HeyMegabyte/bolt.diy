import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { AdminFeatureFlagsComponent } from './feature-flags.component';
import { ToastService } from '../../../services/toast.service';
import { ConfirmService } from '../../../services/confirm.service';
import { AdminStateService } from '../admin-state.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';

/**
 * First coverage for the Feature Flags admin section — the control surface for the
 * SUPREME feature-flags mandate. Security-critical contract:
 *  - resolvedOn(): a kill-switched flag is OFF regardless of enabled (killswitch wins)
 *  - filtered()/countForStage(): stage + search filtering is correct
 *  - displayRollout(): live drag draft overrides the committed value per-flag
 *  - reload(): success populates + clears error; failure sets the inline error
 * overrideComponent strips the template so ngOnInit's async reload doesn't auto-fire.
 */
/** Derive the exact FlagDefinition shape from the component (not exported) so stage's union matches. */
type Flag = Parameters<AdminFeatureFlagsComponent['resolvedOn']>[0];

function flag(over: Partial<Flag> = {}): Flag {
  return { key: 'k', description: '', default_enabled: false, default_rollout_percent: 0, stage: 'experimental', kill_switch: false, owner_email: 'brian@megabyte.space', ...over };
}

function make(get: jasmine.Spy, opts: { disabled?: string } = {}): AdminFeatureFlagsComponent {
  const http = { get, post: () => of({}), patch: () => of({}) };
  TestBed.configureTestingModule({
    imports: [AdminFeatureFlagsComponent],
    providers: [
      { provide: HttpClient, useValue: http },
      { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
      { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
      { provide: AdminStateService, useValue: { selectedSite: signal(null), isSuperAdmin: () => false } },
      { provide: FeatureFlagService, useValue: { invalidate: () => undefined, isOn: () => of(false) } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: { get: (k: string) => (k === 'disabled' ? opts.disabled ?? null : null) } } },
      },
    ],
  });
  TestBed.overrideComponent(AdminFeatureFlagsComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminFeatureFlagsComponent).componentInstance;
}

const okGet = () => jasmine.createSpy('get').and.callFake((url: string) =>
  url.includes('/auth/me') ? of({ is_super_admin: false }) : of({ flags: [], count: 0 }));

describe('AdminFeatureFlagsComponent (flag control surface)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('resolvedOn: a killswitched flag is OFF even when enabled (killswitch wins)', () => {
    const c = make(okGet());
    expect(c.resolvedOn(flag({ default_enabled: true, kill_switch: false }))).toBe(true);
    expect(c.resolvedOn(flag({ default_enabled: true, kill_switch: true }))).toBe(false);
    expect(c.resolvedOn(flag({ default_enabled: false, kill_switch: false }))).toBe(false);
  });

  it('filterAnnouncement(): announces the filtered count + active stage for screen readers', () => {
    const c = make(okGet());
    c.flags.set([
      flag({ key: 'a', stage: 'beta' }),
      flag({ key: 'b', stage: 'stable' }),
      flag({ key: 'c', stage: 'beta' }),
    ]);
    c.stage.set('all');
    expect(c.filterAnnouncement()).toBe('Showing 3 flags');
    c.stage.set('beta');
    expect(c.filterAnnouncement()).toBe('2 flags in beta');
    c.stage.set('stable');
    expect(c.filterAnnouncement()).withContext('singular noun for one match').toBe('1 flag in stable');
  });

  it('filtered(): applies the stage filter and the search query', () => {
    const c = make(okGet());
    c.flags.set([
      flag({ key: 'a', stage: 'beta' }),
      flag({ key: 'b', stage: 'stable' }),
      flag({ key: 'checkout_v2', stage: 'beta', description: 'new checkout' }),
    ]);
    c.stage.set('beta');
    expect(c.filtered().map((f) => f.key)).toEqual(['a', 'checkout_v2']);
    c.search.set('checkout');
    expect(c.filtered().map((f) => f.key)).toEqual(['checkout_v2']);
  });

  it('countForStage(): all = total, else per-stage', () => {
    const c = make(okGet());
    c.flags.set([flag({ stage: 'beta' }), flag({ stage: 'beta' }), flag({ stage: 'stable' })]);
    expect(c.countForStage('all')).toBe(3);
    expect(c.countForStage('beta')).toBe(2);
    expect(c.countForStage('stable')).toBe(1);
  });

  it('displayRollout(): a live drag draft overrides the committed value for that flag only', () => {
    const c = make(okGet());
    const f = flag({ key: 'k', default_rollout_percent: 25 });
    expect(c.displayRollout(f)).toBe(25);
    c.rolloutDraft.set({ key: 'k', pct: 60 });
    expect(c.displayRollout(f)).toBe(60);
    expect(c.displayRollout(flag({ key: 'other', default_rollout_percent: 10 }))).toBe(10);
  });

  it('clearFilters() resets search + stage', () => {
    const c = make(okGet());
    c.search.set('x'); c.stage.set('beta');
    c.clearFilters();
    expect(c.search()).toBe('');
    expect(c.stage()).toBe('all');
  });

  it('reload() success populates flags and clears error', async () => {
    const c = make(jasmine.createSpy('get').and.callFake((url: string) =>
      url.includes('/auth/me') ? of({ is_super_admin: false }) : of({ flags: [flag({ key: 'a' })], count: 1 })));
    await c.reload();
    expect(c.flags().length).toBe(1);
    expect(c.error()).toBeNull();
    expect(c.loading()).toBe(false);
  });

  it('reload() failure sets the inline error (not a silent empty)', async () => {
    const c = make(jasmine.createSpy('get').and.returnValue(throwError(() => ({ status: 500 }))));
    await c.reload();
    expect(c.error()).not.toBeNull();
    expect(c.loading()).toBe(false);
  });

  // ── ?disabled=<key> handoff from featureFlagGuard ─────────────────────────
  const flagsGet = () =>
    jasmine.createSpy('get').and.callFake((url: string) =>
      url.includes('/auth/me') ? of({ is_super_admin: false }) : of({ flags: [], count: 0 }));

  it('ngOnInit surfaces ?disabled=<key> as a banner + pre-filters the search to that flag', async () => {
    const c = make(flagsGet(), { disabled: 'native_editor' });
    await c.ngOnInit();
    expect(c.blockedFeature()).toBe('native_editor'); // explains the guard bounce
    expect(c.search()).toBe('native_editor'); // list jumps straight to that flag
  });

  it('shows no blocked banner when ?disabled is absent', async () => {
    const c = make(flagsGet());
    await c.ngOnInit();
    expect(c.blockedFeature()).toBeNull();
    expect(c.search()).toBe('');
  });

  it('dismissBlockedBanner() clears the banner', async () => {
    const c = make(flagsGet(), { disabled: 'voice_agent' });
    await c.ngOnInit();
    expect(c.blockedFeature()).toBe('voice_agent');
    c.dismissBlockedBanner();
    expect(c.blockedFeature()).toBeNull();
  });
});
