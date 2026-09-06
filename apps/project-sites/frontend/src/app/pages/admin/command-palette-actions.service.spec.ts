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

  // The Forms empty state + onboarding checklist both tell users to press ⌘K →
  // "Copy app.js install snippet". That command MUST exist (it was missing — a dead
  // instruction) and copy the correct data-slug script tag app.js self-locates.
  it('wires "Copy app.js install snippet" to copy the data-slug script tag', () => {
    const s = svc();
    const { ctx } = ctxOf();
    const copy = ctx.copy as jasmine.Spy;
    const actions = s.build(ctx as never);
    const cmd = actions.find((a) => a.id === 'act-copy-appjs');
    expect(cmd).withContext('the app.js install-snippet command must exist').toBeTruthy();
    cmd!.run();
    expect(copy).toHaveBeenCalled();
    const [snippet] = copy.calls.mostRecent().args as [string, string];
    expect(snippet).toContain('src="https://projectsites.dev/app.js"');
    expect(snippet).toContain('data-slug="demo"');
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
    '/admin/voice', '/admin/billing', '/admin/settings', '/admin/user', '/admin/docs',
    '/admin/apps', '/admin/social', '/admin/deliverability', '/admin/webhooks',
    '/admin/feature-flags',
    // Unified logging dashboard (audit + log explorer merged 2026-06-08).
    '/admin/logs',
    '/admin/site-features',
    // NOTE: /admin/pseo is NOT here — it has a section label but no route, no sidebar
    // nav item, and no palette Navigation command (never built). Re-add it here the
    // same turn a route + a `go(...)` command ships for it, so this stays a true
    // "every sidebar section is navigable" gate.
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

  // The old "Go to Review Links" nav command was replaced by a "Share link…"
  // Action that opens the modal (the page was removed 2026-06-08).
  it('exposes a "Share link…" Action that opens the Share-link dialog (not a nav route)', async () => {
    const { ShareLinkService } = await import('../../services/share-link.service');
    const s = svc();
    const shareLink = TestBed.inject(ShareLinkService);
    const openSpy = spyOn(shareLink, 'open');
    const actions = s.build(ctxOf().ctx as never);
    const cmd = actions.find((a) => a.id === 'cmd-share-link');
    expect(cmd).withContext('share-link command present').toBeTruthy();
    expect(cmd!.section).toBe('Actions');
    expect(cmd!.href).withContext('opens a modal, not a route').toBeUndefined();
    cmd!.run();
    expect(openSpy).toHaveBeenCalled();
  });
});

describe('CommandPaletteActionsService (advertised chords are all implemented)', () => {
  afterEach(() => TestBed.resetTestingModule());

  // The g-chords wired in admin.component.ts: e s a f l c b v d u →
  // editor/snapshots/analytics/forms/traces/ai-chat/billing/voice/domains/user.
  const IMPLEMENTED = new Set(['G E', 'G S', 'G A', 'G F', 'G L', 'G C', 'G B', 'G V', 'G D', 'G U']);

  it('no Navigation command advertises a g-chord the handler does not implement (no dead shortcut chips)', () => {
    const { actions } = build();
    for (const a of actions.filter((x) => x.section === 'Navigation' && x.shortcut)) {
      expect(IMPLEMENTED.has(a.shortcut!)).withContext(`${a.id} advertises unimplemented chord "${a.shortcut}"`).toBeTrue();
    }
  });

  it('AI Traces uses the real G L chord (not the old mislabelled G T)', () => {
    const { actions } = build();
    expect(actions.find((a) => a.id === 'nav-traces')?.shortcut).toBe('G L');
    // logs (the merged audit + log-explorer nav) does not claim G L (→ Traces)
    expect(actions.find((a) => a.id === 'nav-logs')?.shortcut).toBeFalsy();
  });
});
