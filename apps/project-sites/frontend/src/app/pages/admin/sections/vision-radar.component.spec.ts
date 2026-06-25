import { TestBed } from '@angular/core/testing';
import { VisionRadarComponent, parseVisionScores } from './vision-radar.component';

describe('parseVisionScores', () => {
  it('parses the 6 stored axes in order, clamped 0–10', () => {
    const json = JSON.stringify({
      layout: 8,
      typography: 7,
      color: 9,
      imagery: 6,
      whitespace: 11, // over-max → clamps to 10
      distinctiveness: 5,
    });
    const axes = parseVisionScores(json);
    expect(axes?.map((a) => a.axis)).toEqual([
      'Layout',
      'Type',
      'Color',
      'Imagery',
      'Space',
      'Distinct',
    ]);
    expect(axes?.find((a) => a.axis === 'Space')?.value).toBe(10);
  });

  it('returns null for empty / malformed / too-few-axes input', () => {
    expect(parseVisionScores(null)).toBeNull();
    expect(parseVisionScores('')).toBeNull();
    expect(parseVisionScores('{ not json')).toBeNull();
    expect(parseVisionScores(JSON.stringify({ layout: 8 }))).toBeNull(); // <3 axes
  });
});

describe('VisionRadarComponent', () => {
  function make(scores: { axis: string; value: number }[]) {
    TestBed.configureTestingModule({ imports: [VisionRadarComponent] });
    const f = TestBed.createComponent(VisionRadarComponent);
    f.componentRef.setInput('scores', scores);
    f.detectChanges();
    return f;
  }

  const SIX = [
    { axis: 'Layout', value: 8 },
    { axis: 'Type', value: 7 },
    { axis: 'Color', value: 9 },
    { axis: 'Imagery', value: 6 },
    { axis: 'Space', value: 10 },
    { axis: 'Distinct', value: 5 },
  ];

  it('renders an SVG radar with a data polygon + the average score', () => {
    const f = make(SIX);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="vision-radar"]')).toBeTruthy();
    expect(el.querySelector('.vr-area')).toBeTruthy();
    // avg = (8+7+9+6+10+5)/6 = 7.5
    expect(el.querySelector('.vr-cap')?.textContent).toContain('7.5/10');
    expect(el.querySelectorAll('.vr-label').length).toBe(6);
  });

  it('renders nothing for fewer than 3 axes', () => {
    const f = make([{ axis: 'Layout', value: 8 }]);
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="vision-radar"]')).toBeNull();
  });
});
