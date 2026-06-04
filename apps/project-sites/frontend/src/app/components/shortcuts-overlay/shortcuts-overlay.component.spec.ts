import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ShortcutsOverlayComponent } from './shortcuts-overlay.component';

/**
 * The `?` cheat-sheet must only advertise g-chords the admin.component handler
 * actually implements (e s a f l c b v). It previously listed "Go to Docs"
 * (G D) + "Go to User settings" (G U) — neither wired → dead shortcuts — and
 * omitted the real G C / G B / G V. This guards it stays honest.
 */
describe('ShortcutsOverlayComponent (cheat-sheet lists only implemented chords)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function text(): string {
    TestBed.configureTestingModule({ imports: [ShortcutsOverlayComponent], providers: [provideNoopAnimations()] });
    const fx = TestBed.createComponent(ShortcutsOverlayComponent);
    fx.componentInstance.open.set(true);
    fx.detectChanges();
    return (fx.nativeElement as HTMLElement).textContent ?? '';
  }

  it('shows the real chords (AI Chat / Billing / Voice / Domains / User)', () => {
    const t = text();
    expect(t).toContain('Open AI Chat');
    expect(t).toContain('Go to Billing');
    expect(t).toContain('Go to Voice');
    expect(t).toContain('Go to AI Traces'); // G L, real
    expect(t).toContain('Go to Domains'); // G D, now wired
    expect(t).toContain('Go to User settings'); // G U, now wired
  });

  it('does NOT advertise the dead Docs g-chord (G D maps to Domains, not Docs)', () => {
    const t = text();
    expect(t).not.toContain('Go to Docs');
  });

  it('does NOT advertise unimplemented Action shortcuts (Cmd+Shift+P, 1/2/3 traces filters)', () => {
    const t = text();
    expect(t).not.toContain('Re-run last command palette action'); // Cmd+Shift+P — never wired
    expect(t).not.toContain('AI Traces: All filter');               // 1/2/3 — no such filter UI exists
    expect(t).not.toContain('AI Traces: Today filter');
    expect(t).not.toContain('AI Traces: Errors filter');
    // real Action shortcuts remain
    expect(t).toContain('Save & deploy');
    expect(t).toContain('Toggle theme');
    expect(t).toContain('Toggle sidebar');
  });
});
