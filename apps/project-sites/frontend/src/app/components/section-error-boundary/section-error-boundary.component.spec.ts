import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SectionErrorBoundaryComponent } from './section-error-boundary.component';
import { SectionErrorBus } from './section-error-bus';
import { ToastService } from '../../services/toast.service';

/**
 * Crash-isolation contract for the per-section error boundary. The whole point
 * is that one section blowing up does NOT take the dashboard down: a boundary
 * shows its fallback ONLY for an error on its own route segment (or a route-less
 * global error), and IGNORES a sibling section's crash. If the route filter
 * regressed, every mounted boundary would flash a crash panel on any error —
 * the opposite of isolation. Also locks reload() recovery. overrideComponent
 * strips the heavy SVG template so the bus/route logic is tested in isolation.
 */
function make(routerUrl = '/admin/forms'): { c: SectionErrorBoundaryComponent; bus: SectionErrorBus } {
  TestBed.configureTestingModule({
    imports: [SectionErrorBoundaryComponent],
    providers: [
      SectionErrorBus,
      { provide: Router, useValue: { url: routerUrl } },
      { provide: ToastService, useValue: { error: () => 0, success: () => 0 } },
    ],
  });
  TestBed.overrideComponent(SectionErrorBoundaryComponent, { set: { template: '<div></div>', imports: [] } });
  const fx = TestBed.createComponent(SectionErrorBoundaryComponent);
  fx.detectChanges(); // ngOnInit → subscribe to the bus
  return { c: fx.componentInstance, bus: TestBed.inject(SectionErrorBus) };
}

describe('SectionErrorBoundaryComponent (crash isolation)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the fallback for an error on THIS route segment', () => {
    const { c, bus } = make('/admin/forms');
    bus.push({ message: 'boom', route: '/admin/forms' });
    expect(c.hasError()).toBeTrue();
    expect(c.lastError()?.message).toBe('boom');
  });

  it('IGNORES a sibling section crash (different route) — that is the whole point of isolation', () => {
    const { c, bus } = make('/admin/forms');
    bus.push({ message: 'boom', route: '/admin/billing' });
    expect(c.hasError()).withContext('a crash in /admin/billing must not trip the /admin/forms boundary').toBeFalse();
  });

  it('shows the fallback for a route-less (global) error', () => {
    const { c, bus } = make('/admin/forms');
    bus.push({ message: 'global boom' });
    expect(c.hasError()).toBeTrue();
  });

  it('reload() recovers — clears the error + lastError so the section can re-render', () => {
    const { c, bus } = make('/admin/forms');
    bus.push({ message: 'boom', route: '/admin/forms' });
    expect(c.hasError()).toBeTrue();
    c.reload();
    expect(c.hasError()).toBeFalse();
    expect(c.lastError()).toBeNull();
  });
});
