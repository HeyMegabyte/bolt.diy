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

  it('shows the real chords (AI Chat / Billing / Voice)', () => {
    const t = text();
    expect(t).toContain('Open AI Chat');
    expect(t).toContain('Go to Billing');
    expect(t).toContain('Go to Voice');
    expect(t).toContain('Go to AI Traces'); // G L, real
  });

  it('does NOT advertise the dead Docs / User-settings g-chords', () => {
    const t = text();
    expect(t).not.toContain('Go to Docs');
    expect(t).not.toContain('Go to User settings');
  });
});
