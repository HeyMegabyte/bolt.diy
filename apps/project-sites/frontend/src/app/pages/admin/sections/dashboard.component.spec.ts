import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AdminDashboardComponent } from './dashboard.component';
import { DashboardChatService } from './dashboard/dashboard-chat.service';
import { SlashCommandRegistryService, type SlashCommand } from './dashboard/slash-command-registry.service';
import { AdminStateService } from '../admin-state.service';
import { AuthService } from '../../../services/auth.service';

/**
 * Guards the dashboard command-palette keyboard logic that drives its ARIA
 * combobox/listbox state (aria-expanded / aria-activedescendant / aria-selected):
 * a `/`-prefixed query opens the palette, Arrow keys roam the selection (wrap),
 * Escape closes, and a non-slash query closes it. Logic-level (overrideComponent
 * strips the heavy dashboard template + child-component DI graph) so the test is
 * robust; the real template's aria bindings are AOT-verified by `ng build`.
 */
const CMDS: SlashCommand[] = [
  { id: 'snapshot', label: 'Snapshot', description: 'Take a snapshot', glyph: 'camera' },
  { id: 'analytics', label: 'Analytics', description: 'View analytics', glyph: 'chart', argHint: '7d' },
  { id: 'settings', label: 'Settings', description: 'Open settings', glyph: 'gear' },
];

const chatStub = () => ({
  messages: signal([]),
  streaming: signal(false),
  lastPill: signal(null),
  setPill: jasmine.createSpy('setPill'),
  submit: jasmine.createSpy('submit').and.resolveTo(undefined),
});
let chat: ReturnType<typeof chatStub>;

function make(): AdminDashboardComponent {
  chat = chatStub();
  TestBed.configureTestingModule({
    imports: [AdminDashboardComponent],
    providers: [
      { provide: DashboardChatService, useValue: chat },
      {
        provide: SlashCommandRegistryService,
        useValue: {
          commands: () => CMDS,
          search: (v: string) => (v.startsWith('/') ? CMDS.filter((c) => `/${c.id}`.startsWith(v)) : []),
          parse: () => null,
        },
      },
      { provide: AdminStateService, useValue: { selectedSite: signal(null) } },
      { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl'), navigate: jasmine.createSpy('navigate'), events: of() } },
    ],
  });
  // Isolate the palette LOGIC: strip the heavy template + child-component imports
  // (AdminUpgradesShellComponent → AdminUpgradesService.router.events) so the test
  // exercises onInput/onKey/paletteIdx on the component's own (stubbed) injects.
  TestBed.overrideComponent(AdminDashboardComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminDashboardComponent).componentInstance;
}

describe('AdminDashboardComponent (command palette)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens the palette with matches on a slash query (idx starts at 0)', () => {
    const c = make();
    c.draft = '/s';
    c.onInput();
    expect(c.palette()).toBe(true);
    expect(c.matches().length).toBe(2); // /snapshot, /settings
    expect(c.paletteIdx()).toBe(0);
  });

  it('closes the palette for a non-slash query', () => {
    const c = make();
    c.draft = '/s';
    c.onInput();
    c.draft = 'hello there';
    c.onInput();
    expect(c.palette()).toBe(false);
  });

  it('ArrowDown / ArrowUp roam the active option and wrap', () => {
    const c = make();
    c.draft = '/'; // matches all 3
    c.onInput();
    expect(c.matches().length).toBe(3);
    const ev = (key: string) => ({ key, preventDefault: jasmine.createSpy('preventDefault') }) as unknown as KeyboardEvent;
    c.onKey(ev('ArrowDown'));
    expect(c.paletteIdx()).toBe(1);
    c.onKey(ev('ArrowDown'));
    expect(c.paletteIdx()).toBe(2);
    c.onKey(ev('ArrowDown'));
    expect(c.paletteIdx()).toBe(0); // wraps
    c.onKey(ev('ArrowUp'));
    expect(c.paletteIdx()).toBe(2); // wraps back
  });

  it('Escape closes the palette', () => {
    const c = make();
    c.draft = '/';
    c.onInput();
    c.onKey({ key: 'Escape', preventDefault: () => {} } as unknown as KeyboardEvent);
    expect(c.palette()).toBe(false);
  });

  // The dock submit button is [disabled] while streaming; the quick-example
  // buttons + feature pills mirror that with [disabled]="chat.streaming()" + a
  // method guard so a click landing mid-stream (focus race / programmatic) is a
  // clean no-op, never a second concurrent stream. Guards the affordance contract.
  it('quick() and pillClick() no-op while a chat is streaming', () => {
    const c = make();
    chat.streaming.set(true);
    c.quick('Make my hero punchier');
    c.pillClick(CMDS[0]);
    expect(chat.submit).not.toHaveBeenCalled();
    expect(chat.setPill).not.toHaveBeenCalled();
  });

  it('quick() submits when not streaming (guard only blocks mid-stream)', () => {
    const c = make();
    chat.streaming.set(false);
    c.quick('Make my hero punchier');
    expect(chat.submit).toHaveBeenCalledWith('Make my hero punchier');
  });
});

import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { AdminUpgradesShellComponent } from '../../../components/admin-upgrades/admin-upgrades-shell.component';

/**
 * The /admin landing features-banner is the dashboard entry to the two-layer
 * feature plane. Icons must render as monochrome stroke SVGs (never the
 * colourful ⚡/⚑ emoji that broke the cyan/black cockpit). The "System Admin"
 * (platform-ops) card is operator-only — gated to sys-admin identities, exactly
 * like the sidebar nav + sysAdminGuard; every owner sees the "Features" card.
 */
describe('AdminDashboardComponent (features-banner)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function renderBanner(email: string): HTMLElement {
    TestBed.configureTestingModule({
      imports: [AdminDashboardComponent],
      providers: [
        provideRouter([]),
        { provide: DashboardChatService, useValue: chatStub() },
        { provide: SlashCommandRegistryService, useValue: { commands: () => [], search: () => [], parse: () => null } },
        { provide: AdminStateService, useValue: { selectedSite: signal(null) } },
        { provide: AuthService, useValue: { email: () => email } },
        {
          provide: TranslateService,
          useValue: { instant: (k: string) => k, get: (k: string) => of(k), stream: (k: string) => of(k), use: () => of({}), setDefaultLang: () => 0, addLangs: () => 0, currentLang: 'en', onLangChange: of(), onTranslationChange: of(), onDefaultLangChange: of() },
        },
      ],
    });
    // Neuter the heavy always-rendered upgrades shell (its own DI graph) so the
    // dashboard's REAL template (incl. the banner) renders.
    TestBed.overrideComponent(AdminUpgradesShellComponent, { set: { template: '', imports: [] } });
    const fx = TestBed.createComponent(AdminDashboardComponent);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }

  it('renders both banner icons as SVGs (not ⚡/⚑ emoji) for a System Administrator', () => {
    const host = renderBanner('brian@megabyte.space');
    const icons = host.querySelectorAll('.features-banner-icon');
    expect(icons.length).withContext('Features + System Admin cards').toBe(2);
    icons.forEach((i) => expect(i.querySelector('svg')).withContext('icon is an SVG').not.toBeNull());
    const banner = host.querySelector('.features-banner')?.textContent ?? '';
    expect(banner).not.toContain('⚡');
    expect(banner).not.toContain('⚑');
  });

  it('shows only the owner-facing Features card to a non-operator (hides System Admin)', () => {
    const host = renderBanner('owner@acme.com');
    const cards = host.querySelectorAll('.features-banner-card');
    expect(cards.length).withContext('only the Features card').toBe(1);
    expect(host.querySelector('[data-testid="dash-features-card"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="dash-system-admin-card"]')).toBeNull();
    // The Features card points at the owner-facing layer, never the retired hub.
    expect(host.querySelector('[data-testid="dash-features-card"]')?.getAttribute('href')).toContain('/admin/site-features');
  });
});

/**
 * The feature pills are toggle buttons whose active feature is signalled ONLY by
 * colour + glow (`.pill.on`). Status-by-colour-alone is a WCAG 1.4.1 failure for
 * screen-reader users, so each pill must expose its selected state via
 * `aria-pressed` reflecting `chat.lastPill() === cmd.id` — not just a CSS class.
 */
describe('AdminDashboardComponent (pill aria-pressed)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function renderPills(activeId: string | null): HTMLElement {
    const chat = chatStub();
    (chat.lastPill as { set: (v: string | null) => void }).set(activeId);
    TestBed.configureTestingModule({
      imports: [AdminDashboardComponent],
      providers: [
        provideRouter([]),
        { provide: DashboardChatService, useValue: chat },
        { provide: SlashCommandRegistryService, useValue: { commands: () => CMDS, search: () => [], parse: () => null } },
        { provide: AdminStateService, useValue: { selectedSite: signal(null) } },
        {
          provide: TranslateService,
          useValue: { instant: (k: string) => k, get: (k: string) => of(k), stream: (k: string) => of(k), use: () => of({}), setDefaultLang: () => 0, addLangs: () => 0, currentLang: 'en', onLangChange: of(), onTranslationChange: of(), onDefaultLangChange: of() },
        },
      ],
    });
    TestBed.overrideComponent(AdminUpgradesShellComponent, { set: { template: '', imports: [] } });
    const fx = TestBed.createComponent(AdminDashboardComponent);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }

  it('marks every pill with aria-pressed (true on the active feature, false otherwise)', () => {
    const host = renderPills('analytics'); // CMDS[1]
    const pills = host.querySelectorAll('.pill');
    expect(pills.length).withContext('all registry commands render as pills').toBe(CMDS.length);
    pills.forEach((pill) => {
      const pressed = pill.getAttribute('aria-pressed');
      expect(pressed).withContext('every pill exposes aria-pressed').not.toBeNull();
    });
    const active = host.querySelector('.pill.on');
    expect(active?.getAttribute('aria-pressed')).withContext('active pill is pressed').toBe('true');
  });

  it('reports aria-pressed=false on all pills when no feature is active', () => {
    const host = renderPills(null);
    const pills = host.querySelectorAll('.pill');
    pills.forEach((pill) => expect(pill.getAttribute('aria-pressed')).toBe('false'));
    expect(host.querySelector('.pill.on')).withContext('no pill is visually active').toBeNull();
  });
});
