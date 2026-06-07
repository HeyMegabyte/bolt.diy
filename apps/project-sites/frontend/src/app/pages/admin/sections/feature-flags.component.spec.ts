import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { AdminFeatureFlagsComponent } from './feature-flags.component';
import { bucketFor } from './feature-flags/flag-logic';
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

  // isFiltering() drives the VISIBLE "N of M" count chip (sighted parity with the
  // sr-only filterAnnouncement) — only shows when a search query OR a non-'all'
  // stage filter is active, so the toolbar stays clean in the default view.
  it('isFiltering(): false in the default view, true once a search or stage filter is active', () => {
    const c = make(okGet());
    expect(c.isFiltering()).withContext('default view → no count chip').toBeFalse();
    c.search.set('checkout');
    expect(c.isFiltering()).withContext('active search → count chip').toBeTrue();
    c.search.set('   ');
    expect(c.isFiltering()).withContext('whitespace-only search → not filtering').toBeFalse();
    c.stage.set('beta');
    expect(c.isFiltering()).withContext('non-all stage → count chip').toBeTrue();
    c.stage.set('all');
    expect(c.isFiltering()).withContext('back to all + blank search → clean').toBeFalse();
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
 * Each flag card carries a cyan rollout progress bar — an at-a-glance scan of
 * how far each flag is rolled out (role=progressbar for a11y; dimmed when the
 * flag is off, since rollout is then moot).
 */
describe('AdminFeatureFlagsComponent (flag-card rollout bar)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render() {
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
    return TestBed.createComponent(AdminFeatureFlagsComponent);
  }

  it('renders a cyan rollout progressbar reflecting the rollout %', () => {
    const f = render();
    f.detectChanges(); // ngOnInit → reload sets flags from the (empty) mock first
    f.componentInstance.flags.set([flag({ key: 'k', default_enabled: true, default_rollout_percent: 40 })]);
    f.componentInstance.loading.set(false);
    f.detectChanges(); // now render the list with our flag
    const bar = (f.nativeElement as HTMLElement).querySelector('.ff-rollout-bar');
    expect(bar).withContext('rollout bar rendered on the card').toBeTruthy();
    expect(bar!.getAttribute('role')).toBe('progressbar');
    expect(bar!.getAttribute('aria-valuenow')).toBe('40');
    expect((bar!.querySelector('.ff-rollout-fill') as HTMLElement).style.width).withContext('fill width = rollout %').toBe('40%');
  });

  it('the flag owner email is a clickable mailto link (contact the owner)', () => {
    const f = render();
    f.detectChanges();
    f.componentInstance.flags.set([flag({ key: 'k', owner_email: 'brian@megabyte.space' })]);
    f.componentInstance.loading.set(false);
    f.detectChanges();
    const link = (f.nativeElement as HTMLElement).querySelector('.ff-owner a') as HTMLAnchorElement;
    expect(link).withContext('owner email rendered as a link').toBeTruthy();
    expect(link.getAttribute('href')).toBe('mailto:brian@megabyte.space');
    expect(link.textContent).toContain('brian@megabyte.space');
  });

  it('the Refresh button shows "Refreshing…" + aria-busy while loading (feedback, not inert)', () => {
    const f = render();
    f.detectChanges();
    f.componentInstance.loading.set(true);
    f.detectChanges();
    const btn = (f.nativeElement as HTMLElement).querySelector('button[aria-label="Refresh flag list"]') as HTMLButtonElement;
    expect(btn).withContext('refresh button rendered').toBeTruthy();
    expect(btn.disabled).withContext('disabled while loading').toBeTrue();
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent).toContain('Refreshing…');
    f.componentInstance.loading.set(false);
    f.detectChanges();
    expect(btn.textContent).toContain('Refresh');
    expect(btn.textContent).not.toContain('Refreshing');
  });

  it('dims the rollout fill when the flag is off (rollout is moot)', () => {
    const f = render();
    f.detectChanges();
    f.componentInstance.flags.set([flag({ key: 'off', default_enabled: false, default_rollout_percent: 80 })]);
    f.componentInstance.loading.set(false);
    f.detectChanges();
    const fill = (f.nativeElement as HTMLElement).querySelector('.ff-rollout-fill');
    expect(fill?.classList.contains('ff-rollout-fill--off')).withContext('off flag → dimmed fill').toBeTrue();
  });

  // premature-stat-during-load: the header subtitle ("N registered · M on") must
  // not assert a definitive "0 registered · 0 on" while the flag list is still
  // loading (skeleton below). Show a muted "…" until the load resolves.
  it('the header counts show "…" (not a false 0) while flags are still loading', () => {
    const f = render();
    f.detectChanges(); // ngOnInit reload → flags [] + loading false
    f.componentInstance.loading.set(true); // simulate the in-flight initial load (no data yet)
    f.detectChanges();
    const sub = (f.nativeElement as HTMLElement).querySelector('.ff-sub') as HTMLElement;
    expect(sub.textContent ?? '').withContext('honest loading placeholder, not a definitive 0').toContain('…');
    expect(sub.querySelector('app-rolling-counter')).withContext('no rolling count over a loading skeleton').toBeNull();
  });

  it('the header renders real rolling-counters once flags load', () => {
    const f = render();
    f.detectChanges();
    f.componentInstance.flags.set([flag({ key: 'a', default_enabled: true }), flag({ key: 'b', default_enabled: false })]);
    f.componentInstance.loading.set(false);
    f.detectChanges();
    const sub = (f.nativeElement as HTMLElement).querySelector('.ff-sub') as HTMLElement;
    expect(sub.querySelectorAll('app-rolling-counter').length).withContext('registered + on counters').toBe(2);
    expect(sub.textContent ?? '').not.toContain('…');
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

/**
 * Core mutation engine — every toggle/rollout/killswitch routes through
 * requestOverride → (dangerous? confirm : applyOverride). The brief's
 * toggles / rollout controls / reason-gated confirmation, plus the
 * revert-on-failure reliability contract. confirmDangerous is what actually
 * SENDS the change + persists the reason to the audit trail.
 */
describe('AdminFeatureFlagsComponent (core mutation engine)', () => {
  afterEach(() => TestBed.resetTestingModule());
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  function mk(post: jasmine.Spy): AdminFeatureFlagsComponent {
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

  it('toggling a flag OFF at a small rollout (non-dangerous) applies directly via super-admin POST', async () => {
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const c = mk(post);
    // rollout 10 → 0 is a <25-pt drop ⇒ review-risk, not dangerous ⇒ direct apply.
    c.flags.set([flag({ key: 'k', default_enabled: true, default_rollout_percent: 10 })]);
    c.toggle(c.flags()[0]);
    await flush();
    expect(c.pending()).withContext('small-rollout disable is review-risk, not a confirm').toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ key: 'k', enabled_globally: false }));
  });

  it('toggling a flag ON (dangerous) opens the confirm panel — no immediate POST', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const c = mk(post);
    c.flags.set([flag({ key: 'k', default_enabled: false, default_rollout_percent: 0 })]);
    c.toggle(c.flags()[0]);
    expect(c.pending()).withContext('enable-from-off is dangerous → confirm').not.toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('confirmDangerous sends the patch WITH the typed reason (audit trail)', async () => {
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const c = mk(post);
    c.flags.set([flag({ key: 'k', default_enabled: false, default_rollout_percent: 0 })]);
    c.toggle(c.flags()[0]); // opens pending
    c.dangerReason.set('Sev-1 launch');
    await c.confirmDangerous();
    expect(post).toHaveBeenCalledTimes(1);
    const body = post.calls.mostRecent().args[1];
    expect(body.key).toBe('k');
    expect(body.enabled_globally).toBeTrue();
    expect(body.reason).withContext('reason persisted for the audit trail').toBe('Sev-1 launch');
    expect(c.pending()).toBeNull();
  });

  it('confirmDangerous refuses a <4-char reason (no POST, panel stays open)', async () => {
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const c = mk(post);
    c.flags.set([flag({ key: 'k', default_enabled: false })]);
    c.toggle(c.flags()[0]);
    c.dangerReason.set('x');
    await c.confirmDangerous();
    expect(post).not.toHaveBeenCalled();
    expect(c.pending()).withContext('still awaiting a valid reason').not.toBeNull();
  });

  it('reverts the optimistic change when the POST fails', async () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 403 })));
    const c = mk(post);
    c.flags.set([flag({ key: 'k', default_enabled: true, default_rollout_percent: 10 })]);
    c.toggle(c.flags()[0]); // small-rollout disable → direct apply → POST fails
    await flush();
    expect(c.flags()[0].default_enabled).withContext('reverted to enabled after failure').toBeTrue();
  });

  it('setRollout clamps out-of-range values into [0,100]', () => {
    const post = jasmine.createSpy('post').and.returnValue(of({}));
    const c = mk(post);
    c.flags.set([flag({ key: 'k', default_enabled: true, default_rollout_percent: 50 })]);
    c.setRollout(c.flags()[0], 150); // clamps to 100; 50→100 = +50 ⇒ dangerous ⇒ confirm
    expect(c.pending()?.patch.rollout_pct).withContext('clamped to 100').toBe(100);
  });
});

/**
 * Expert-mode "test context builder": the evaluation trace must re-evaluate for
 * an arbitrary test subject the engineer types (user id / site id / anon id),
 * not a single fixed subject. Rollout bucketing is FNV-1a(flagKey+subject), so
 * a different subject genuinely changes the rollout decision — this is how an
 * operator debugs "why does user X see the flag but user Y doesn't".
 */
describe('AdminFeatureFlagsComponent (Expert eval-trace test-subject builder)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('defaults the trace subject to the platform when nothing is typed (no selected site)', () => {
    const c = make(okGet());
    const f = flag({ default_enabled: true, default_rollout_percent: 50 });
    expect(c.resolvedSubject()).toBe('platform');
    expect(c.bucketOf(f)).toBe(bucketFor('k', 'platform'));
  });

  it('re-evaluates the trace for a typed subject (bucket + rollout step follow the subject)', () => {
    const c = make(okGet());
    const f = flag({ default_enabled: true, default_rollout_percent: 50 });
    c.traceSubject.set('user-xyz');
    expect(c.resolvedSubject()).toBe('user-xyz');
    expect(c.bucketOf(f)).toBe(bucketFor('k', 'user-xyz'));
    // The eval trace itself reflects the subject's bucket (partial-rollout step).
    const detailHasBucket = c.traceFor(f).some((s) => s.detail.includes(String(c.bucketOf(f))));
    expect(detailHasBucket).withContext('trace rollout step shows the subject bucket').toBeTrue();
  });

  it('falls back to the default subject when the typed subject is blank/whitespace', () => {
    const c = make(okGet());
    c.traceSubject.set('   ');
    expect(c.resolvedSubject()).toBe('platform');
  });
});

/**
 * The System-Admin flag console's emergency/danger affordances must use
 * monochrome stroke SVGs (inherit the red danger ink), never the colourful
 * ⛔ (U+26D4) / ⚠ (U+26A0) emoji that broke the cyan/black cockpit.
 */
describe('AdminFeatureFlagsComponent (emergency/danger icons are SVGs, not emoji)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the Emergency button glyph as an SVG, no ⛔ emoji', () => {
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
    f.detectChanges();
    const btn = (f.nativeElement as HTMLElement).querySelector('[data-testid="ff-emergency-open"]');
    expect(btn).withContext('emergency button renders').toBeTruthy();
    expect(btn!.querySelector('svg')).withContext('button glyph is an SVG').toBeTruthy();
    expect(btn!.textContent ?? '').withContext('no ⛔ emoji').not.toContain('⛔');
  });
});

/**
 * Expert-mode "diff": before Apply, show exactly which fields the edited JSON
 * payload changes vs the committed flag (the brief's Expert "diffs" + a pre-Apply
 * blast-radius preview). Pure logic — invalid/absent draft yields no diff.
 */
describe('AdminFeatureFlagsComponent (Expert JSON payload diff)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists the fields the edited payload would change (and nothing when unchanged/invalid)', () => {
    const c = make(okGet());
    const f = flag({ key: 'k', default_enabled: false, default_rollout_percent: 50, kill_switch: false });

    expect(c.jsonDiff(f)).withContext('no draft → no diff').toEqual([]);

    c.setJsonDraft('k', JSON.stringify({ key: 'k', enabled_globally: false, rollout_pct: 0, kill_switch: true }));
    const d = c.jsonDiff(f);
    expect(d.map((x) => x.field).sort()).toEqual(['kill_switch', 'rollout_pct']);
    expect(d.find((x) => x.field === 'rollout_pct')).toEqual({ field: 'rollout_pct', from: '50', to: '0' });

    c.setJsonDraft('k', JSON.stringify({ key: 'k', enabled_globally: false, rollout_pct: 50, kill_switch: false }));
    expect(c.jsonDiff(f)).withContext('identical payload → no diff').toEqual([]);

    c.setJsonDraft('k', '{ not json');
    expect(c.jsonDiff(f)).withContext('invalid JSON → no diff (error path owns it)').toEqual([]);
  });
});

/**
 * Expert-mode "API payload": a copyable curl to reproduce the flag mutation via
 * the super-admin API (the brief's Expert "API payloads"). Must reflect the
 * edited draft when valid + carry a PLACEHOLDER token (never leak a real one).
 */
describe('AdminFeatureFlagsComponent (Expert API payload / curl)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('curlFor builds a reproducible POST curl (placeholder token, reflects the draft)', () => {
    const c = make(okGet());
    const f = flag({ key: 'k', default_enabled: true, default_rollout_percent: 25, kill_switch: false });
    const curl = c.curlFor(f);
    expect(curl).toContain('curl -X POST');
    expect(curl).toContain('/api/super-admin/feature-flags');
    expect(curl).withContext('placeholder, not a real session token').toContain('<YOUR_TOKEN>');
    expect(curl).toContain('"rollout_pct":25');
    expect(curl).toContain('"enabled_globally":true');

    c.setJsonDraft('k', JSON.stringify({ key: 'k', enabled_globally: false, rollout_pct: 0, kill_switch: true }));
    const edited = c.curlFor(f);
    expect(edited).withContext('reflects a valid edited draft').toContain('"rollout_pct":0');
    expect(edited).toContain('"kill_switch":true');

    c.setJsonDraft('k', '{ not json');
    expect(c.curlFor(f)).withContext('invalid draft falls back to the committed payload').toContain('"rollout_pct":25');
  });
});

/**
 * The Advanced-mode "Expires (optional)" input was a dead affordance — its
 * expiryDraft fed nothing. Wire it into the payload so a set expiry rides along
 * in the Expert JSON view + curl + the next POST (worker decides persistence).
 */
describe('AdminFeatureFlagsComponent (expiry wires into the payload)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('jsonPayloadFor + curlFor include expires_at only when an expiry is set', () => {
    const c = make(okGet());
    const f = flag({ key: 'k' });
    expect(c.jsonPayloadFor(f)).withContext('no expiry → omitted').not.toContain('expires_at');

    c.setExpiryDraft('k', '2026-12-31T23:59');
    expect(c.jsonPayloadFor(f)).withContext('set expiry rides in the payload').toContain('"expires_at": "2026-12-31T23:59"');
    expect(c.curlFor(f)).withContext('curl reflects it too').toContain('expires_at');

    c.setExpiryDraft('k', '');
    expect(c.jsonPayloadFor(f)).withContext('cleared → omitted again').not.toContain('expires_at');
  });
});
