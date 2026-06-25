import { TestBed } from '@angular/core/testing';
import {
  SavingsCalculatorComponent,
  buildSavingsRows,
} from './savings-calculator.component';

describe('buildSavingsRows', () => {
  const rows = buildSavingsRows();

  it('only includes apps where the SaaS equivalent costs MORE than self-hosting', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.savesUsd > 0)).toBeTrue();
    expect(rows.every((r) => r.saasUsd > r.selfHostUsd)).toBeTrue();
  });

  it('is sorted by biggest saving first', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].savesUsd).toBeGreaterThanOrEqual(rows[i].savesUsd);
    }
  });

  it('savesUsd is exactly saasUsd − selfHostUsd', () => {
    expect(rows.every((r) => r.savesUsd === r.saasUsd - r.selfHostUsd)).toBeTrue();
  });
});

describe('SavingsCalculatorComponent', () => {
  function make(): SavingsCalculatorComponent {
    TestBed.configureTestingModule({ imports: [SavingsCalculatorComponent] });
    const f = TestBed.createComponent(SavingsCalculatorComponent);
    f.detectChanges();
    return f.componentInstance;
  }

  it('preselects every row and the monthly saving equals the row sum', () => {
    const c = make();
    expect(c.picked().size).toBe(c.rows.length);
    const expected = c.rows.reduce((s, r) => s + r.savesUsd, 0);
    expect(c.savedMonthly()).toBe(expected);
    expect(c.savedAnnual()).toBe(expected * 12);
  });

  it('toggling an app off reduces the saving by exactly that app’s delta', () => {
    const c = make();
    const before = c.savedMonthly();
    const row = c.rows[0];
    c.toggle(row.id);
    expect(c.picked().has(row.id)).toBeFalse();
    expect(c.savedMonthly()).toBe(before - row.savesUsd);
    c.toggle(row.id); // back on
    expect(c.savedMonthly()).toBe(before);
  });

  it('renders the headline saving + a per-app pick row', () => {
    const c = make();
    const f = TestBed.createComponent(SavingsCalculatorComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sav-monthly"]')).toBeTruthy();
    expect(el.querySelector(`[data-testid="sav-pick-${c.rows[0].id}"]`)).toBeTruthy();
  });
});
