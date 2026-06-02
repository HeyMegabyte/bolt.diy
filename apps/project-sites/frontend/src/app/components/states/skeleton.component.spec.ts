import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SkeletonComponent } from './skeleton.component';

/**
 * Regression guard for the admin-wide loading-state primitive. Locks the a11y
 * contract (host role=status + aria-busy=true + aria-live=polite so AT
 * announces the loading state once), the variant→geometry mapping
 * (text/table/card/chart), and the `rows` clamp (min 1, floored) so a refactor
 * can't regress loading UX or accessibility.
 */
describe('SkeletonComponent', () => {
  let fixture: ComponentFixture<SkeletonComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SkeletonComponent] }).compileComponents();
    fixture = TestBed.createComponent(SkeletonComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);

  it('creates', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('exposes the loading a11y contract on the host (role=status, aria-busy, aria-live)', () => {
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.getAttribute('aria-live')).toBe('polite');
  });

  it('defaults to the text variant', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.variant).toBe('text');
    expect(host.getAttribute('data-variant')).toBe('text');
    expect(q('.sk-text')).not.toBeNull();
  });

  it('renders the matching geometry per variant + reflects it to data-variant', () => {
    for (const [variant, sel] of [
      ['table', '.sk-table'],
      ['card', '.sk-cards'],
      ['chart', '.sk-chart'],
      ['text', '.sk-text'],
    ] as const) {
      fixture.componentRef.setInput('variant', variant);
      fixture.detectChanges();
      expect(host.getAttribute('data-variant')).toBe(variant);
      expect(q(sel)).not.toBeNull();
    }
  });

  it('clamps rows to a minimum of 1 and floors fractions', () => {
    fixture.componentRef.setInput('rows', 0);
    expect(fixture.componentInstance.rows).toBe(1);

    fixture.componentRef.setInput('rows', -5);
    expect(fixture.componentInstance.rows).toBe(1);

    fixture.componentRef.setInput('rows', 3.7);
    expect(fixture.componentInstance.rows).toBe(3);
  });

  it('hides decorative placeholder geometry from assistive tech', () => {
    fixture.componentRef.setInput('variant', 'table');
    fixture.detectChanges();
    expect(q('.sk-table')?.getAttribute('aria-hidden')).toBe('true');
  });
});
