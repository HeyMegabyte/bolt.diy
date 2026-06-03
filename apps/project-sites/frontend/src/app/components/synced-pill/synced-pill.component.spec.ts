import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SyncedPillComponent } from './synced-pill.component';

/**
 * Reusable live-freshness pill. Contract: renders NOTHING until `at` is a real
 * timestamp (never a false "synced" before/without a successful load), and when
 * set, shows a cyan pulse dot + a formatted clock time with the given prefix.
 */
describe('SyncedPillComponent', () => {
  let fx: ComponentFixture<SyncedPillComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SyncedPillComponent] });
    fx = TestBed.createComponent(SyncedPillComponent);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing when `at` is null (no false freshness)', () => {
    fx.componentRef.setInput('at', null);
    fx.detectChanges();
    expect(fx.componentInstance.label()).toBeNull();
    expect((fx.nativeElement as HTMLElement).querySelector('[data-testid="synced-pill"]')).toBeNull();
  });

  it('renders the pill + dot with a formatted time once `at` is set', () => {
    fx.componentRef.setInput('at', Date.UTC(2026, 0, 1, 15, 30, 45));
    fx.detectChanges();
    const pill = (fx.nativeElement as HTMLElement).querySelector('[data-testid="synced-pill"]');
    expect(pill).toBeTruthy();
    expect(pill!.querySelector('.sync-dot')).toBeTruthy();
    expect(fx.componentInstance.label()).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(pill!.textContent).toContain('Synced');
  });

  it('honours a custom prefix', () => {
    fx.componentRef.setInput('at', Date.now());
    fx.componentRef.setInput('prefix', 'Updated');
    fx.detectChanges();
    expect((fx.nativeElement as HTMLElement).querySelector('[data-testid="synced-pill"]')!.textContent).toContain('Updated');
  });
});
