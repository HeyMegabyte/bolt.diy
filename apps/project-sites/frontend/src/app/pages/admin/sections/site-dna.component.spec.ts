import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { of } from 'rxjs';
import { AdminSiteDnaComponent } from './site-dna.component';
import { ApiService } from '../../../services/api.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';

/**
 * Guards the convergence-r11 cohesion pass for the Site DNA section:
 *   - taste-pulse distribution math (segPct / acceptRatio) stays correct
 *   - the screen-reader aria-label mirrors the visible counts
 *   - the flag-gate notice renders when the flag is off (no spurious fetch)
 */
describe('AdminSiteDnaComponent (taste pulse + a11y)', () => {
  let fixture: ComponentFixture<AdminSiteDnaComponent>;
  let component: AdminSiteDnaComponent;
  let isOn: jasmine.Spy;
  let apiGet: jasmine.Spy;

  function build(flagOn: boolean): void {
    isOn = jasmine.createSpy('isOn').and.returnValue(of(flagOn));
    apiGet = jasmine.createSpy('get').and.returnValue(of({ history: [], preferences: [] }));
    TestBed.configureTestingModule({
      imports: [AdminSiteDnaComponent, RouterModule.forRoot([])],
      providers: [
        { provide: ApiService, useValue: { get: apiGet, post: jasmine.createSpy('post').and.returnValue(of({ id: 'x' })) } },
        { provide: FeatureFlagService, useValue: { isOn } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'site-dna-1' } } },
        },
      ],
    });
    fixture = TestBed.createComponent(AdminSiteDnaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the flag-gate notice and skips the data fetch when the flag is off', () => {
    build(false);
    expect(component.flagEnabled()).toBe(false);
    expect(apiGet).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="dna-flag-gate"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="dna-taste-pulse"]')).toBeNull();
  });

  it('computes accept ratio as a whole-number percent of all signals', () => {
    build(true);
    component.history.set([
      row('accept'), row('accept'), row('accept'),
      row('reject'),
      row('edit'),
    ]);
    fixture.detectChanges();
    // 3 of 5 accepted → 60%
    expect(component.acceptRatio()).toBe(60);
  });

  it('returns 0% accept ratio + 0 segment width with no signals (no divide-by-zero)', () => {
    build(true);
    expect(component.acceptRatio()).toBe(0);
    expect(component.segPct(0)).toBe(0);
    expect(component.segPct(3)).toBe(0);
  });

  it('segment widths sum to 100% of the total signal volume', () => {
    build(true);
    component.history.set([row('accept'), row('accept'), row('reject'), row('edit')]);
    fixture.detectChanges();
    const sum =
      component.segPct(component.acceptCount()) +
      component.segPct(component.editCount()) +
      component.segPct(component.rejectCount());
    expect(Math.round(sum)).toBe(100);
  });

  it('the pulse aria-label mirrors the visible accept/edit/reject counts', () => {
    build(true);
    component.history.set([row('accept'), row('reject'), row('edit'), row('edit')]);
    fixture.detectChanges();
    const label = component.pulseAriaLabel();
    expect(label).toContain('1 accepted');
    expect(label).toContain('2 edited');
    expect(label).toContain('1 rejected');
    expect(label).toContain('out of 4 signals');
  });

  function row(action: 'accept' | 'reject' | 'edit') {
    return {
      id: `r-${Math.random()}`,
      component_id: 'hero',
      component_class: 'hero',
      action,
      context: null,
      created_at: new Date().toISOString(),
    };
  }
});
