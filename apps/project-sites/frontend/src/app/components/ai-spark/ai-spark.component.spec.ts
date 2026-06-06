import { TestBed } from '@angular/core/testing';
import { AiSparkComponent } from './ai-spark.component';

/**
 * Guards the AI-affordance cohesion: the "AI" indicator is a monochrome
 * `currentColor` sparkle SVG (inherits the cockpit cyan / the host's accent),
 * NEVER the colourful `✨` emoji that read off-brand + added SR noise.
 */
describe('AiSparkComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(): HTMLElement {
    const fx = TestBed.createComponent(AiSparkComponent);
    fx.detectChanges();
    return fx.nativeElement as HTMLElement;
  }

  it('renders a monochrome SVG, not an emoji', () => {
    const el = render();
    expect(el.querySelector('svg')).withContext('sparkle svg').toBeTruthy();
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(el.textContent ?? ''))
      .withContext('no ✨ emoji leaked')
      .toBeFalse();
  });

  it('marks the glyph decorative (aria-hidden — the label carries meaning)', () => {
    const el = render();
    expect(el.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('uses currentColor so it inherits the host accent (cyan / violet card / etc.)', () => {
    const el = render();
    const svg = el.querySelector('svg')!;
    // stroke OR fill set to currentColor (either is fine for inheritance)
    const usesCurrentColor =
      svg.getAttribute('stroke') === 'currentColor' || svg.getAttribute('fill') === 'currentColor';
    expect(usesCurrentColor).withContext('svg inherits currentColor').toBeTrue();
  });
});
