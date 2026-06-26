import { TestBed } from '@angular/core/testing';
import { TrendMetricToggleComponent, type TrendMetric } from './trend-metric-toggle.component';

function setup(selected: TrendMetric = 'pageviews') {
  TestBed.configureTestingModule({ imports: [TrendMetricToggleComponent] });
  const fixture = TestBed.createComponent(TrendMetricToggleComponent);
  fixture.componentRef.setInput('selected', selected);
  fixture.detectChanges();
  return fixture;
}

describe('TrendMetricToggleComponent (Views/Visitors/Conversions segmented control)', () => {
  it('renders the three metric options with human labels', () => {
    const el = setup().nativeElement as HTMLElement;
    const btns = el.querySelectorAll('[data-testid="tmt-opt"]');
    expect(btns.length).toBe(3);
    const text = (el.textContent ?? '').toLowerCase();
    expect(text).toContain('views');
    expect(text).toContain('visitors');
    expect(text).toContain('conversions');
  });

  it('marks the selected option active via aria-pressed', () => {
    const el = setup('uniqueSessions').nativeElement as HTMLElement;
    const active = el.querySelector('[data-testid="tmt-opt"][aria-pressed="true"]');
    expect(active?.textContent?.toLowerCase()).toContain('visitors');
  });

  it('emits the chosen metric on click', () => {
    const fixture = setup('pageviews');
    const emitted: string[] = [];
    fixture.componentInstance.change.subscribe((m) => emitted.push(m));
    const btns = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[data-testid="tmt-opt"]',
    );
    btns[2].click(); // Conversions
    expect(emitted).toEqual(['conversions']);
  });
});
