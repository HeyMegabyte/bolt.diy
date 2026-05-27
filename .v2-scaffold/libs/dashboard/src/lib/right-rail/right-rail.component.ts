import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

/**
 * Contextual right-rail panel host. Route-aware: shows a route-specific
 * widget (log tail on `/sites/:id`, AI assistant on `/jobs/:id`,
 * etc.). Lazy-loaded by the shell with `@defer (on viewport)`.
 *
 * @remarks This component is intentionally lightweight; per-feature
 * widgets register themselves by `data-rail-key` later. The current
 * iteration ships the host + an inert default panel.
 */
@Component({
  selector: 'lib-right-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="ps-rail" aria-label="Contextual rail">
      <header class="ps-rail__head">
        <h2 class="ps-rail__title">{{ title() }}</h2>
      </header>
      <div class="ps-rail__body" data-testid="right-rail-body">
        @switch (key()) {
          @case ('sites') {
            <p>Site log tail will mount here.</p>
          }
          @case ('jobs') {
            <p>Job assistant + chat will mount here.</p>
          }
          @case ('bookings') {
            <p>Booking insights + AI summary will mount here.</p>
          }
          @default {
            <p class="ps-rail__hint">Open a record to see its context.</p>
          }
        }
      </div>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .ps-rail {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 16px;
        border-left: 1px solid rgba(255, 255, 255, 0.06);
        background: color-mix(in oklch, var(--ps-bg, #060610) 92%, white 8%);
      }
      .ps-rail__title {
        margin: 0 0 12px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.6;
      }
      .ps-rail__hint {
        opacity: 0.55;
        font-size: 0.9rem;
      }
    `,
  ],
})
export class RightRailComponent {
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** First non-`dashboard` segment, e.g., `sites`, `jobs`, `bookings`. */
  readonly key = computed<string>(() => {
    const parts = this.url().split('?')[0]?.split('/').filter(Boolean) ?? [];
    return parts[0] === 'dashboard' ? (parts[1] ?? '') : (parts[0] ?? '');
  });

  readonly title = computed<string>(() => {
    const k = this.key();
    if (!k) return 'Context';
    return k.slice(0, 1).toUpperCase() + k.slice(1);
  });
}
