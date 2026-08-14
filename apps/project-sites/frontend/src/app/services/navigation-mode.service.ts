import { BreakpointObserver } from '@angular/cdk/layout';
import { isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/**
 * The three intentional navigation presentations. Each maps to a distinct form
 * factor, not merely a width:
 * - `mobile`   — overlay drawer + header hamburger (`< 768px`)
 * - `compact`  — permanent 72px icon rail with tooltips (`768px–1199px`)
 * - `expanded` — full 272px labelled sidebar (`>= 1200px`)
 */
export type NavigationMode = 'mobile' | 'compact' | 'expanded';

/**
 * The ONE place breakpoints are defined. `.98` upper bounds avoid the 1px dead
 * zone between `max-width: 767px` and `min-width: 768px`. Consumed by the media
 * queries here AND mirrored by the SCSS custom-media so CSS-only presentation
 * and behaviour-changing logic can never drift.
 */
export const NAV_BREAKPOINTS = {
  /** Below this ⇒ `mobile`. */
  compactMin: 768,
  /** At/above this ⇒ `expanded`. */
  expandedMin: 1200,
} as const;

const MOBILE_QUERY = `(max-width: ${NAV_BREAKPOINTS.compactMin - 0.02}px)`;
const EXPANDED_QUERY = `(min-width: ${NAV_BREAKPOINTS.expandedMin}px)`;

/**
 * @module services/navigation-mode
 *
 * Single source of truth for the admin shell's responsive navigation mode +
 * mobile-drawer open state. Wraps Angular CDK {@link BreakpointObserver} so the
 * app never scatters `window.innerWidth` / resize listeners across components
 * (which desync, thrash change-detection, and break under SSR/hydration).
 *
 * The mode is a signal, so templates/computeds react without manual
 * subscriptions. The initial value is derived synchronously from the current
 * width (browser) or defaults to `expanded` (non-browser) so the sidebar paints
 * in its correct mode on the first frame — no flash-of-wrong-mode during boot.
 *
 * @example
 * ```ts
 * private nav = inject(NavigationModeService);
 * // template: @if (nav.isMobile()) { <button (click)="nav.toggleDrawer()">…</button> }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class NavigationModeService {
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Current navigation mode. Drives every sidebar presentation decision. */
  readonly mode = signal<NavigationMode>(this.initialMode());

  readonly isMobile = computed(() => this.mode() === 'mobile');
  readonly isCompact = computed(() => this.mode() === 'compact');
  readonly isExpanded = computed(() => this.mode() === 'expanded');

  /**
   * Whether the mobile overlay drawer is open. Meaningless outside `mobile`
   * mode (the rail/sidebar are always visible there); leaving mobile forces it
   * shut so a stray-open drawer can never survive a resize.
   */
  readonly drawerOpen = signal(false);

  constructor() {
    if (!this.isBrowser) return;
    this.breakpoints
      .observe([MOBILE_QUERY, EXPANDED_QUERY])
      .pipe(takeUntilDestroyed())
      .subscribe((state) => {
        const next: NavigationMode = state.breakpoints[MOBILE_QUERY]
          ? 'mobile'
          : state.breakpoints[EXPANDED_QUERY]
            ? 'expanded'
            : 'compact';
        this.mode.set(next);
        // A drawer only exists in mobile mode — crossing a breakpoint always closes it.
        if (next !== 'mobile') this.drawerOpen.set(false);
      });
  }

  /** Open the mobile drawer (no-op semantics outside mobile — the caller gates on {@link isMobile}). */
  openDrawer(): void {
    this.drawerOpen.set(true);
  }

  /** Close the mobile drawer. Safe to call unconditionally (route nav, backdrop, Esc). */
  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  /** Toggle the mobile drawer (hamburger / ⌘B on mobile). */
  toggleDrawer(): void {
    this.drawerOpen.update((v) => !v);
  }

  /** Synchronous first-paint mode so the shell never flashes the wrong layout. */
  private initialMode(): NavigationMode {
    if (typeof window === 'undefined') return 'expanded';
    const w = window.innerWidth;
    if (w < NAV_BREAKPOINTS.compactMin) return 'mobile';
    if (w < NAV_BREAKPOINTS.expandedMin) return 'compact';
    return 'expanded';
  }
}
