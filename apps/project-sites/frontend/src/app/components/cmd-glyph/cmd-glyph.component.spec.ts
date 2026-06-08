import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CmdGlyphComponent } from './cmd-glyph.component';

/**
 * The dashboard quick-pills + slash-command palette previously rendered a
 * colourful emoji map (🌐 📸 🚀 …) that ignored the cockpit cyan/black palette.
 * This primitive replaces them with monochrome `stroke=currentColor` SVGs that
 * inherit the parent colour. These tests lock: every known glyph is an SVG (not
 * an emoji), unknown names fall back to an SVG (never a raw char), the host is
 * decorative (aria-hidden), and the stroke inherits the parent colour.
 */
describe('CmdGlyphComponent', () => {
  let fixture: ComponentFixture<CmdGlyphComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CmdGlyphComponent] }).compileComponents();
    fixture = TestBed.createComponent(CmdGlyphComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  const KNOWN = [
    'globe', 'camera', 'rocket', 'inbox', 'shield', 'chart', 'credit-card',
    'download', 'calendar', 'clock', 'grid', 'book', 'help', 'code', 'message',
  ];

  for (const name of KNOWN) {
    it(`renders a monochrome SVG (not an emoji) for "${name}"`, () => {
      fixture.componentRef.setInput('name', name);
      fixture.detectChanges();
      const svg = host.querySelector('svg[data-testid="cmd-glyph-svg"]');
      expect(svg).withContext(`${name} → svg`).not.toBeNull();
      // a real glyph drawn (≥1 child shape), and stroke inherits the parent colour.
      expect(svg!.children.length).withContext(`${name} draws shapes`).toBeGreaterThan(0);
      expect(svg!.getAttribute('stroke')).toBe('currentColor');
      // no raw emoji text leaked into the rendered output.
      expect(host.textContent?.trim()).withContext('no raw emoji/text').toBe('');
    });
  }

  it('falls back to an SVG (sparkle) for an unknown name, never a raw char', () => {
    fixture.componentRef.setInput('name', 'definitely-not-a-glyph');
    fixture.detectChanges();
    const svg = host.querySelector('svg[data-testid="cmd-glyph-svg"]');
    expect(svg).not.toBeNull();
    expect(svg!.children.length).withContext('fallback draws shapes').toBeGreaterThan(0);
    expect(host.textContent?.trim()).toBe('');
  });

  it('is decorative — the host is aria-hidden so it is not announced', () => {
    fixture.componentRef.setInput('name', 'globe');
    fixture.detectChanges();
    expect(host.getAttribute('aria-hidden')).toBe('true');
  });
});
