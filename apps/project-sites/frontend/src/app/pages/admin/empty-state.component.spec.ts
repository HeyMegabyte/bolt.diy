import { TestBed, ComponentFixture } from '@angular/core/testing';
import { EmptyStateComponent } from './empty-state.component';

/**
 * The admin-local empty-state primitive is shared by 5 sections (ai-endpoints,
 * apps, apps-instances, domains, marketplace). Bring it to a11y parity with the
 * components/states kit: the root is a status region (announces the empty
 * condition once) and the decorative icon glyph is aria-hidden (so SR users
 * don't hear the raw emoji/glyph — e.g. "▦" — before the real title).
 */
describe('AdminEmptyStateComponent (a11y parity)', () => {
  let fx: ComponentFixture<EmptyStateComponent>;
  afterEach(() => TestBed.resetTestingModule());

  function render(icon = '▦'): HTMLElement {
    TestBed.configureTestingModule({ imports: [EmptyStateComponent] });
    fx = TestBed.createComponent(EmptyStateComponent);
    fx.componentRef.setInput('icon', icon);
    fx.componentRef.setInput('title', 'No sections available');
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }

  it('marks the root as a status region so AT announces the empty condition', () => {
    const root = render().querySelector('.empty-state-pretty');
    expect(root?.getAttribute('role')).toBe('status');
  });

  it('marks the decorative icon glyph aria-hidden (SR skips the raw glyph)', () => {
    const glyph = render().querySelector('.empty-glyph');
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
  });

  it('maps a colorful emoji icon to a monochrome cyan SVG (cockpit standard), not the raw emoji', () => {
    const glyph = render('📞').querySelector('.empty-glyph');
    expect(glyph?.querySelector('svg')).withContext('emoji → SVG').not.toBeNull();
    expect(glyph?.textContent?.trim()).withContext('raw emoji replaced by SVG').toBe('');
    expect(glyph?.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
  });

  it('maps the colorful sparkles emoji (✨) to a cyan SVG, never the raw emoji (site-features)', () => {
    // ✨ is emoji-presentation by default → it would render in full color and
    // break the cyan/black cockpit. Site-features uses it for its empty state,
    // so it MUST resolve to a monochrome stroke SVG like every other emoji.
    const glyph = render('✨').querySelector('.empty-glyph');
    expect(glyph?.querySelector('svg')).withContext('✨ → SVG').not.toBeNull();
    expect(glyph?.querySelector('.empty-emoji')).withContext('no raw colorful emoji leaks').toBeNull();
    expect(glyph?.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
  });

  it('falls through to the text glyph for an unmapped on-brand mono symbol (▦)', () => {
    const glyph = render('▦').querySelector('.empty-glyph');
    expect(glyph?.querySelector('svg')).withContext('mono symbol stays text, no SVG').toBeNull();
    expect(glyph?.querySelector('.empty-emoji')?.textContent?.trim()).toBe('▦');
  });
});
