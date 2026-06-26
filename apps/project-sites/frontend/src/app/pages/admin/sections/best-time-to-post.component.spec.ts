import { TestBed } from '@angular/core/testing';
import { BestTimeToPostComponent } from './best-time-to-post.component';

function setup(bestTimes: { platform: string; slots: { day: number; hour: number; confidence: number }[] } | null) {
  TestBed.configureTestingModule({ imports: [BestTimeToPostComponent] });
  const fixture = TestBed.createComponent(BestTimeToPostComponent);
  fixture.componentRef.setInput('bestTimes', bestTimes);
  fixture.detectChanges();
  return fixture;
}

describe('BestTimeToPostComponent (social best-time, data already on the wire)', () => {
  it('formats day / hour / confidence into human labels', () => {
    const c = setup(null).componentInstance;
    expect(c.dayName(0)).toBe('Sunday');
    expect(c.dayName(2)).toBe('Tuesday');
    expect(c.hourLabel(0)).toBe('12 AM');
    expect(c.hourLabel(9)).toBe('9 AM');
    expect(c.hourLabel(12)).toBe('12 PM');
    expect(c.hourLabel(14)).toBe('2 PM');
    expect(c.confidenceLabel(0.9)).toBe('High');
    expect(c.confidenceLabel(0.4)).toBe('Medium');
    expect(c.confidenceLabel(0.1)).toBe('Low');
  });

  it('renders one slot row per best time with platform + labels', () => {
    const fixture = setup({
      platform: 'instagram',
      slots: [
        { day: 2, hour: 14, confidence: 0.9 },
        { day: 4, hour: 18, confidence: 0.5 },
      ],
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="best-time-to-post"]')).toBeTruthy();
    const rows = el.querySelectorAll('[data-testid="btp-slot"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Tuesday');
    expect(rows[0].textContent).toContain('2 PM');
    expect(rows[0].textContent).toContain('High');
    expect((el.textContent ?? '').toLowerCase()).toContain('instagram');
  });

  it('renders nothing when there are no slots (empty or null)', () => {
    const fixture = setup({ platform: 'x', slots: [] });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="best-time-to-post"]')).toBeNull();
    // null input also yields no render
    fixture.componentRef.setInput('bestTimes', null);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="best-time-to-post"]')).toBeNull();
  });
});
