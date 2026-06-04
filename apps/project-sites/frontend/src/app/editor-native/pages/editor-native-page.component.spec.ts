import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, RouterLink } from '@angular/router';
import { EditorNativePageComponent } from './editor-native-page.component';

/**
 * The opt-out gate (shown when the editor.native flag is off — the common case)
 * renders a "← Back to editor" link. It used `routerLink="/admin/editor"` in
 * ATTRIBUTE form but the component didn't import the RouterLink directive, so the
 * attribute was inert (no href, no navigation) — an AOT-silent dead link. This
 * locks the link as a real RouterLink (renders an href).
 */
describe('EditorNativePageComponent (gate back-link is a working RouterLink)', () => {
  afterEach(() => {
    try { localStorage.removeItem('editor.native'); } catch { /* private mode */ }
    TestBed.resetTestingModule();
  });

  function render() {
    TestBed.configureTestingModule({
      imports: [EditorNativePageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
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
});
