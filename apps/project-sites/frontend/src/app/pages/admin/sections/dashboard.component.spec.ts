import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AdminDashboardComponent } from './dashboard.component';
import { DashboardChatService } from './dashboard/dashboard-chat.service';
import { SlashCommandRegistryService, type SlashCommand } from './dashboard/slash-command-registry.service';
import { AdminStateService } from '../admin-state.service';

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

function make(): AdminDashboardComponent {
  TestBed.configureTestingModule({
    imports: [AdminDashboardComponent],
    providers: [
      {
        provide: DashboardChatService,
        useValue: {
          messages: signal([]),
          streaming: signal(false),
          lastPill: signal(null),
          setPill: jasmine.createSpy('setPill'),
          submit: jasmine.createSpy('submit').and.resolveTo(undefined),
        },
      },
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
});
