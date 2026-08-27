import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { CommandPaletteComponent } from './command-palette.component';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';
import { AdminStateService } from './admin-state.service';
import { CommandPaletteActionsService } from './command-palette-actions.service';

/**
 * Regression for the keyboard-a11y defect surfed 2026-08-27: opening the Cmd+K
 * palette and closing it (Escape / backdrop) dropped focus on <body> — a keyboard
 * user's position was lost (next Tab restarted from the top of the document), a
 * WCAG 2.4.3 (Focus Order) violation. Fix: openIt() captures the previously-focused
 * element and close() restores focus to it.
 */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

describe('CommandPaletteComponent — focus restore on close (WCAG 2.4.3)', () => {
  let comp: CommandPaletteComponent;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
      providers: [
        { provide: Router, useValue: { navigateByUrl: () => {}, url: '/admin' } },
        { provide: ApiService, useValue: { get: () => of({ paths: {} }) } },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
        { provide: AuthService, useValue: { getToken: () => null } },
        { provide: AdminStateService, useValue: { selectedSite: () => null, sites: () => [], signOut: () => {} } },
        { provide: CommandPaletteActionsService, useValue: { build: () => [], askAiSearch: () => of([]) } },
      ],
    });
    comp = TestBed.createComponent(CommandPaletteComponent).componentInstance;
    opener = document.createElement('button');
    opener.textContent = 'Opener';
    document.body.appendChild(opener);
    opener.focus();
  });

  afterEach(() => opener.remove());

  it('returns focus to the opener after the palette closes', async () => {
    expect(document.activeElement).toBe(opener);

    comp.openIt();
    expect(comp.open()).toBe(true);

    // Simulate focus moving into the palette (as it does on open).
    const inner = document.createElement('input');
    document.body.appendChild(inner);
    inner.focus();
    expect(document.activeElement).toBe(inner);

    comp.close();
    expect(comp.open()).toBe(false);
    await nextFrame();

    expect(document.activeElement).toBe(opener); // NOT <body>, NOT the palette input
    inner.remove();
  });

  it('does not throw when nothing meaningful was focused (opener = body)', async () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    opener.remove(); // detach so document.activeElement falls back to <body>
    comp.openIt();
    comp.close();
    await nextFrame();
    expect(comp.open()).toBe(false); // no crash, no focus thrown at a detached node
    document.body.appendChild(opener); // restore for afterEach
  });
});
