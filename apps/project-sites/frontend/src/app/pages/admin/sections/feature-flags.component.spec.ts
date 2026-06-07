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

  // ── Destructive-overlay keyboard dismissal (WCAG 2.1.1) ───────────────────
  // The dangerous-change confirm + emergency console are hand-rolled role=dialog
  // overlays (not the shared DialogShell), so they need an explicit Esc handler.
  // (Focus-trap + autofocus + focus-restore are handled by cdkTrapFocusAutoCapture
  // on each overlay — AOT-verified; this covers the Esc-dismiss logic.)
  describe('Esc dismisses the destructive overlays', () => {
    it('closes the dangerous-change confirm panel + clears the typed reason', () => {
      const c = make(okGet());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      c.pending.set({ flag: flag(), label: 'Kill switch', blast: 'all', rollback: 'flip back' } as any);
      c.dangerReason.set('Sev-1 incident');
      c.onEscapeKey();
      expect(c.pending()).toBeNull();
      expect(c.dangerReason()).toBe('');
    });

    it('closes the emergency console + clears the typed reason', () => {
      const c = make(okGet());
      c.emergencyOpen.set(true);
      c.dangerReason.set('Platform incident');
      c.onEscapeKey();
      expect(c.emergencyOpen()).toBeFalse();
      expect(c.dangerReason()).toBe('');
    });

    it('is a no-op when neither overlay is open', () => {
      const c = make(okGet());
      expect(() => c.onEscapeKey()).not.toThrow();
      expect(c.pending()).toBeNull();
      expect(c.emergencyOpen()).toBeFalse();
    });

    it('closes the confirm panel first when both could be open (no double-close)', () => {
      const c = make(okGet());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      c.pending.set({ flag: flag(), label: 'Enable', blast: 'all', rollback: 'disable' } as any);
      c.emergencyOpen.set(true);
      c.onEscapeKey();
      expect(c.pending()).withContext('confirm panel closed first').toBeNull();
      expect(c.emergencyOpen()).withContext('emergency stays open for a second Esc').toBeTrue();
    });
  });

  // ── Expert-mode JSON payload editor (input validation, WCAG-alert + reliability) ──
  // applyJson is a runtime boundary: a malformed/garbage payload must NOT reach
  // the worker. It surfaces a per-flag `jsonError` (role=alert) and bails.
  describe('applyJson (Expert JSON payload validation)', () => {
    const setDraft = (c: ReturnType<typeof make>, key: string, raw: string) =>
      c.jsonEditorDraft.set({ [key]: raw });

    it('rejects invalid JSON syntax (does not apply)', () => {
      const c = make(okGet());
      const f = flag({ key: 'k' });
      setDraft(c, 'k', '{ not valid json ');
      c.applyJson(f);
      expect(c.jsonError()['k']).toBe('Invalid JSON — fix the syntax before applying.');
      expect(c.pending()).withContext('no override routed on invalid input').toBeNull();
    });

    it('rejects a non-object payload (e.g. a bare number)', () => {
      const c = make(okGet());
      setDraft(c, 'k', '42');
      c.applyJson(flag({ key: 'k' }));
      expect(c.jsonError()['k']).toBe('Payload must be a JSON object.');
    });

    it('rejects an object with no recognized fields', () => {
      const c = make(okGet());
      setDraft(c, 'k', '{"foo":1,"bar":true}');
      c.applyJson(flag({ key: 'k' }));
      expect(c.jsonError()['k']).toBe('No recognized fields (enabled_globally / rollout_pct / kill_switch).');
    });

    it('ignores recognized fields of the wrong type (rollout_pct as string → no-op)', () => {
      const c = make(okGet());
      setDraft(c, 'k', '{"rollout_pct":"50"}'); // string, not number → not applied
      c.applyJson(flag({ key: 'k' }));
      expect(c.jsonError()['k']).toBe('No recognized fields (enabled_globally / rollout_pct / kill_switch).');
    });

    it('accepts a valid recognized payload + clears the error', () => {
      const c = make(okGet());
      setDraft(c, 'k', '{"rollout_pct":50}');
      c.applyJson(flag({ key: 'k', default_rollout_percent: 0 }));
      expect(c.jsonError()['k']).withContext('error cleared past validation').toBe('');
    });
  });
});

import { provideRouter } from '@angular/router';

/**
 * Cockpit cohesion: the blocked-feature banner icon must be a monochrome SVG
 * (cyan/black brand), NOT the colorful 🔒 emoji. Matches the documented
 * emoji→SVG standard (voice share-tab, features-hub).
 */
describe('AdminFeatureFlagsComponent (blocked banner uses a mono SVG lock, not emoji)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders an SVG lock in the blocked banner, no 🔒 emoji', () => {
    TestBed.configureTestingModule({
      imports: [AdminFeatureFlagsComponent],
      providers: [
        provideRouter([]),
        { provide: HttpClient, useValue: { get: () => of({ data: [] }), patch: () => of({}), post: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: AdminStateService, useValue: { selectedSite: signal(null), isSuperAdmin: () => false } },
        { provide: FeatureFlagService, useValue: { invalidate: () => undefined, isOn: () => of(false) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of({ get: () => null }), snapshot: { queryParamMap: { get: () => null } } } },
      ],
    });
    const f = TestBed.createComponent(AdminFeatureFlagsComponent);
    f.componentInstance.blockedFeature.set('voice_agent');
    f.detectChanges();
    const banner = (f.nativeElement as HTMLElement).querySelector('[data-testid="ff-blocked-banner"]');
    expect(banner).withContext('blocked banner renders when blockedFeature is set').toBeTruthy();
    const icon = banner!.querySelector('.ff-blocked-icon');
    expect(icon!.querySelector('svg')).withContext('icon is a monochrome SVG lock').toBeTruthy();
    expect(icon!.textContent ?? '').withContext('no 🔒 emoji glyph').not.toMatch(/\u{1F512}/u);
  });
});

/**
 * Emergency console — the highest-blast destructive admin action (kills every
 * non-stable flag platform-wide). The brief's "emergency controls" test item.
 * Safety contract: NEVER touches stable or core_ sentinel flags; requires a
 * typed reason; each kill is a super-admin POST carrying that reason.
 */
describe('AdminFeatureFlagsComponent (emergency kill-all)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function makeWithPost(post: jasmine.Spy): AdminFeatureFlagsComponent {
    const get = jasmine.createSpy('get').and.callFake((url: string) =>
      url.includes('/auth/me') ? of({ is_super_admin: false }) : of({ flags: [], count: 0 }));
    TestBed.configureTestingModule({
      imports: [AdminFeatureFlagsComponent],
      providers: [
        { provide: HttpClient, useValue: { get, post, patch: () => of({}) } },
        { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: AdminStateService, useValue: { selectedSite: signal(null), isSuperAdmin: () => false } },
        { provide: FeatureFlagService, useValue: { invalidate: () => undefined, isOn: () => of(false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    });
    TestBed.overrideComponent(AdminFeatureFlagsComponent, { set: { template: '<div></div>', imports: [] } });
    return TestBed.createComponent(AdminFeatureFlagsComponent).componentInstance;
  }

  it('emergencyTargets selects only non-stable, non-core, non-killswitch flags', () => {
    const c = makeWithPost(jasmine.createSpy('post').and.returnValue(of({})));
    c.flags.set([
      flag({ key: 'stable_x', stage: 'stable', default_enabled: true }),
      flag({ key: 'core_auth', stage: 'experimental', default_enabled: true }),
      flag({ key: 'exp_a', stage: 'experimental', default_enabled: true }),
      flag({ key: 'beta_b', stage: 'beta', default_enabled: true }),
      flag({ key: 'killed_c', stage: 'killswitch', default_enabled: false }),
    ]);
    const keys = c.emergencyTargets().map((f) => f.key);
    expect(keys).toContain('exp_a');
    expect(keys).toContain('beta_b');
    expect(keys).withContext('never kills stable').not.toContain('stable_x');
    expect(keys).withContext('never kills core sentinels').not.toContain('core_auth');
    expect(keys).withContext('skips already-killswitch-staged').not.toContain('killed_c');
  });

  it('refuses to fire without a ≥4-char reason (no POST, console stays open)', async () => {
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const c = makeWithPost(post);
    c.flags.set([flag({ key: 'exp_a', stage: 'experimental', default_enabled: true })]);
    c.emergencyOpen.set(true);
    c.dangerReason.set('x'); // < 4 chars
    await c.killAllNonStable();
    expect(post).not.toHaveBeenCalled();
    expect(c.emergencyOpen()).withContext('guard bailed — console not closed').toBeTrue();
  });

  it('kills each non-stable target via super-admin POST (reason attached) + closes the console; stable untouched', async () => {
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const c = makeWithPost(post);
    c.flags.set([
      flag({ key: 'exp_a', stage: 'experimental', default_enabled: true }),
      flag({ key: 'beta_b', stage: 'beta', default_enabled: true }),
      flag({ key: 'stable_x', stage: 'stable', default_enabled: true }),
    ]);
    c.emergencyOpen.set(true);
    c.dangerReason.set('Platform incident — kill experimental surfaces');
    await c.killAllNonStable();
    expect(post).toHaveBeenCalledTimes(2); // only the 2 non-stable targets
    for (const args of post.calls.allArgs()) {
      expect(args[0]).toBe('/api/super-admin/feature-flags');
      expect(args[1].kill_switch).withContext('each kill sets kill_switch').toBeTrue();
      expect(args[1].reason).toContain('Platform incident');
    }
    const killed = post.calls.allArgs().map((a) => a[1].key);
    expect(killed).withContext('stable flag never killed').not.toContain('stable_x');
    expect(c.emergencyOpen()).withContext('console closed after sweep').toBeFalse();
    expect(c.emergencyBusy()).toBeFalse();
  });
});
