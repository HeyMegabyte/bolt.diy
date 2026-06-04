import { TestBed } from '@angular/core/testing';
import { CommandPaletteActionsService } from './command-palette-actions.service';

/**
 * Coverage for CommandPaletteActionsService — builds the Cmd+K admin command set (a SUPREME
 * surface). Contract: a well-formed, unique-id action list whose run() callbacks are correctly
 * wired to the injected deps (navigation/theme/sign-out), and per-site quick-switch entries
 * when sites are supplied. A duplicate id or unwired run() = a broken palette.
 */
function ctxOf(over: Partial<Record<string, unknown>> = {}) {
  const go = jasmine.createSpy('go');
  const setTheme = jasmine.createSpy('setTheme');
  const signOut = jasmine.createSpy('signOut');
  const ctx = {
    go, openExt: jasmine.createSpy('openExt'), copy: jasmine.createSpy('copy'),
    slug: 'demo', siteId: 's1',
    sites: [{ id: 's1', slug: 'demo', business_name: 'Demo Co', status: 'published' }],
    setTheme, toggleSidebar: () => undefined, signOut, createSnapshot: () => undefined,
    ...over,
  };
  return { ctx, go, setTheme, signOut };
}

/** Inject the service once per test; build() is a pure method callable repeatedly. */
function svc(): CommandPaletteActionsService {
  TestBed.configureTestingModule({ providers: [CommandPaletteActionsService] });
  return TestBed.inject(CommandPaletteActionsService);
}

function build(over: Partial<Record<string, unknown>> = {}) {
  const s = svc();
  const { ctx, go, setTheme, signOut } = ctxOf(over);
  return { actions: s.build(ctx as never), go, setTheme, signOut };
}

describe('CommandPaletteActionsService (Cmd+K command set)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('builds a non-empty, well-formed action list (id + title + section + run)', () => {
    const { actions } = build();
    expect(actions.length).toBeGreaterThan(10);
    for (const a of actions) {
      expect(a.id).toBeTruthy();
      expect(a.title).toBeTruthy();
      expect(a.section).toBeTruthy();
      expect(typeof a.run).toBe('function');
    }
  });

  it('has NO duplicate action ids (a dupe breaks palette keying/selection)', () => {
    const { actions } = build();
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('wires the nav-editor run() to go(/admin/editor)', () => {
    const { actions, go } = build();
    const editor = actions.find((a) => a.id === 'nav-editor');
    expect(editor).toBeTruthy();
    editor!.run();
    expect(go).toHaveBeenCalledWith('/admin/editor');
  });

  it('wires a sign-out command to the signOut dep', () => {
    const { actions, signOut } = build();
    const out = actions.find((a) => /sign\s*out/i.test(a.title));
    expect(out).withContext('a sign-out command should exist').toBeTruthy();
    out!.run();
    expect(signOut).toHaveBeenCalled();
  });

  it('emits per-site quick-switch entries when sites are supplied', () => {
    const s = svc(); // one service instance; build() is pure — call it twice
    const withSites = s.build(ctxOf().ctx as never).length;
    const noSites = s.build(ctxOf({ sites: [] }).ctx as never).length;
    expect(withSites).toBeGreaterThan(noSites);
  });
});

describe('CommandPaletteActionsService (every sidebar section is quick-navigable)', () => {
  afterEach(() => TestBed.resetTestingModule());

  // The sidebar's routerLink targets — Cmd+K must be able to reach each one.
  const SIDEBAR_ROUTES = [
    '/admin/editor', '/admin/snapshots', '/admin/analytics', '/admin/forms', '/admin/traces',
    '/admin/voice', '/admin/billing', '/admin/audit', '/admin/settings', '/admin/user', '/admin/docs',
    '/admin/apps', '/admin/social', '/admin/bulk-ops', '/admin/deliverability', '/admin/webhooks',
    '/admin/recipes', '/admin/review-links', '/admin/feature-flags', '/admin/marketplace',
    '/admin/logs', '/admin/enterprise', '/admin/trust', '/admin/stripe-app-status',
  ];

  it('has a Navigation command that navigates to every sidebar route', () => {
    const { actions, go } = build();
    const nav = actions.filter((a) => a.section === 'Navigation');
    for (const route of SIDEBAR_ROUTES) {
      const cmd = nav.find((a) => a.href?.endsWith(route));
      expect(cmd).withContext(`missing Cmd+K Navigation command for ${route}`).toBeTruthy();
      go.calls.reset();
      cmd!.run();
      expect(go).withContext(`${cmd!.id} should navigate to ${route}`).toHaveBeenCalledWith(route);
    }
  });
});
