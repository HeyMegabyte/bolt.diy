import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { EditorNativePageComponent } from './editor-native-page.component';
import { FeatureFlagService } from '../../services/feature-flag.service';

/**
 * The opt-out gate (shown when the editor.native flag is off — the common case)
 * renders a "← Back to editor" link. It used `routerLink="/admin/editor"` in
 * ATTRIBUTE form but the component didn't import the RouterLink directive, so the
 * attribute was inert (no href, no navigation) — an AOT-silent dead link. This
 * locks the link as a real RouterLink (renders an href).
 *
 * Also locks the server-flag calm fallback: a dark `native_editor` flag renders
 * the flag-disabled notice + dimmed card INSIDE the shell — never a blank main
 * (rules/feature-flags.md notice+dimmed pattern; feature-journey blank-main fix).
 */
describe('EditorNativePageComponent (gate back-link is a working RouterLink)', () => {
  afterEach(() => {
    try { localStorage.removeItem('editor.native'); } catch { /* private mode */ }
    TestBed.resetTestingModule();
  });

  function render(serverFlagOn = true) {
    TestBed.configureTestingModule({
      imports: [EditorNativePageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        // Stub the server flag — the real service would drag HttpClient in.
        { provide: FeatureFlagService, useValue: { isOn: () => of(serverFlagOn) } },
      ],
    });
    // Strip the heavy <app-editor-chat> (only in the allowed branch, never hit
    // here) so the gate-branch render needs no WebContainer/editor deps — but
    // KEEP RouterLink so the back-link binds (that's what we're asserting).
    TestBed.overrideComponent(EditorNativePageComponent, { set: { imports: [RouterLink] } });
    const fx = TestBed.createComponent(EditorNativePageComponent);
    fx.detectChanges(); // ngOnInit → no flag → allowed=false → gate renders
    return fx.nativeElement as HTMLElement;
  }

  it('shows the gate when the native flag is off', () => {
    expect(render().querySelector('[data-testid="editor-native-gate"]')).not.toBeNull();
  });

  it('the "Back to editor" link renders an href (working RouterLink, not a dead attribute)', () => {
    const link = render().querySelector('a[routerLink="/admin/editor"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/admin/editor');
  });

  it('a dark server flag renders the calm flag-disabled notice (never a blank main)', () => {
    const el = render(false);
    const notice = el.querySelector('[data-testid="editor-native-flag-notice"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('native_editor');
    // Still inside the shell with a working escape hatch.
    expect(el.querySelector('a[routerLink="/admin/editor"]')).not.toBeNull();
  });

  it('a live server flag keeps the opt-in copy (no disabled notice)', () => {
    const el = render(true);
    expect(el.querySelector('[data-testid="editor-native-flag-notice"]')).toBeNull();
    expect(el.textContent).toContain('opt-in');
  });
});
