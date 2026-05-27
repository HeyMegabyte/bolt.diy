/**
 * Verifies the wizard's schedule step honors doctrine §10:
 *  - Single-day default shows a standard datetime picker
 *  - Multi-day toggle reveals per-day tabbed cards
 *  - Each day card's "Start and end time" caption lives bottom-right
 *    (computed `text-align: right`)
 */
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { QuoteWizardComponent } from '../quote-wizard.component.js';

describe('QuoteWizardComponent', () => {
  let fixture: ComponentFixture<QuoteWizardComponent>;
  let cmp: QuoteWizardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuoteWizardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(QuoteWizardComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('defaults to single-day with a standard datetime picker', () => {
    cmp.goto('schedule');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="single-day-picker"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="multi-day-tabs"]')).toBeNull();
    const start = host.querySelector<HTMLInputElement>('[data-testid="single-day-start"]');
    expect(start?.type).toBe('datetime-local');
  });

  it('multi-day toggle reveals per-day tab cards', () => {
    cmp.goto('schedule');
    cmp.setMultiDay(true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="multi-day-tabs"]')).toBeTruthy();
    expect(host.querySelectorAll('[data-testid^="tab-Day"]').length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector('[data-testid="day-card-Day 1"]')).toBeTruthy();
  });

  it('renders the "Start and end time" caption bottom-right', () => {
    cmp.goto('schedule');
    cmp.setMultiDay(true);
    fixture.detectChanges();
    const caption = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="day-card-caption"]'
    );
    expect(caption).toBeTruthy();
    expect(caption!.textContent?.trim()).toBe('Start and end time');
    const style = getComputedStyle(caption!);
    // Bottom-right anchor: text-align right + absolute positioning with right offset
    expect(style.textAlign).toBe('right');
    expect(style.position).toBe('absolute');
    expect(style.right).not.toBe('auto');
    expect(style.bottom).not.toBe('auto');
  });

  it('does not bounce other days when one day is edited', () => {
    cmp.goto('schedule');
    cmp.setMultiDay(true);
    const before = cmp.state();
    const day1Start = before.days[0]!.start;

    // Mutate day 2 only
    cmp.onDayChange({ ...before.days[1]!, end: '2030-06-02T18:00:00.000Z' }, 1);
    const after = cmp.state();
    expect(after.days[0]!.start).toBe(day1Start); // untouched
    expect(after.days[1]!.end).toBe('2030-06-02T18:00:00.000Z');
  });
});
