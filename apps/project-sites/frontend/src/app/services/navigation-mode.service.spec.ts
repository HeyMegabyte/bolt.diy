/**
 * @module services/navigation-mode.service.spec
 *
 * The responsive brain. Proves the mode is derived from CDK breakpoint state
 * (not window.innerWidth spaghetti) and that the mobile drawer can never leak
 * across a breakpoint change.
 */
import { TestBed } from '@angular/core/testing';
import { BreakpointObserver, type BreakpointState } from '@angular/cdk/layout';
import { BehaviorSubject } from 'rxjs';
import { NavigationModeService } from './navigation-mode.service';

// Must mirror the exact media queries the service observes.
const MOBILE = '(max-width: 767.98px)';
const EXPANDED = '(min-width: 1297px)';

function stateFor(mode: 'mobile' | 'compact' | 'expanded'): BreakpointState {
  return {
    matches: mode !== 'compact',
    breakpoints: { [MOBILE]: mode === 'mobile', [EXPANDED]: mode === 'expanded' },
  };
}

describe('NavigationModeService', () => {
  let state$: BehaviorSubject<BreakpointState>;

  function make(initial: 'mobile' | 'compact' | 'expanded' = 'expanded'): NavigationModeService {
    state$ = new BehaviorSubject<BreakpointState>(stateFor(initial));
    TestBed.configureTestingModule({
      providers: [
        { provide: BreakpointObserver, useValue: { observe: () => state$.asObservable() } },
      ],
    });
    return TestBed.inject(NavigationModeService);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('derives expanded / compact / mobile from breakpoint state', () => {
    const svc = make('expanded');
    expect(svc.mode()).toBe('expanded');
    expect(svc.isExpanded()).toBeTrue();

    state$.next(stateFor('compact'));
    expect(svc.mode()).toBe('compact');
    expect(svc.isCompact()).toBeTrue();

    state$.next(stateFor('mobile'));
    expect(svc.mode()).toBe('mobile');
    expect(svc.isMobile()).toBeTrue();
  });

  it('opens / closes / toggles the drawer', () => {
    const svc = make('mobile');
    expect(svc.drawerOpen()).toBeFalse();
    svc.openDrawer();
    expect(svc.drawerOpen()).toBeTrue();
    svc.toggleDrawer();
    expect(svc.drawerOpen()).toBeFalse();
    svc.toggleDrawer();
    expect(svc.drawerOpen()).toBeTrue();
    svc.closeDrawer();
    expect(svc.drawerOpen()).toBeFalse();
  });

  it('force-closes an open drawer when leaving mobile (no stuck overlay)', () => {
    const svc = make('mobile');
    svc.openDrawer();
    expect(svc.drawerOpen()).toBeTrue();
    state$.next(stateFor('compact'));
    expect(svc.drawerOpen()).withContext('drawer must close crossing 768').toBeFalse();
    expect(svc.mode()).toBe('compact');
  });

  it('exactly one of isMobile/isCompact/isExpanded is true at a time', () => {
    const svc = make('expanded');
    for (const m of ['mobile', 'compact', 'expanded'] as const) {
      state$.next(stateFor(m));
      const flags = [svc.isMobile(), svc.isCompact(), svc.isExpanded()].filter(Boolean);
      expect(flags.length).withContext(`mode ${m}`).toBe(1);
    }
  });
});
