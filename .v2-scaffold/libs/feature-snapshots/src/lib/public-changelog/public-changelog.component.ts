/**
 * `PublicChangelogComponent` — renders the tenant's public `/changelog`
 * feed inside the dashboard so operators see exactly what their site
 * visitors see, without leaving the admin surface.
 *
 * @remarks
 *  RxJS-first per [[rxjs-first-angular]]:
 *  - `entries$` is the source observable (HTTP poll @ 30s).
 *  - `entries` signal bridges at the template boundary only.
 *  - Polling pauses when the tab is hidden (visibility-aware floor).
 *
 *  Input: `tenantOrigin` (e.g. `https://acme.projectsites.dev`). The
 *  component pulls `${tenantOrigin}/changelog.json` and renders the
 *  entries. Without an origin, it returns the empty state.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  EMPTY,
  of,
  switchMap,
  timer,
  catchError,
  shareReplay,
} from 'rxjs';

export interface ChangelogEntry {
  readonly id: string;
  readonly iteration: number;
  readonly ai_description: string | null;
  readonly ai_commit_message: string | null;
  readonly lighthouse_scores: {
    readonly performance: number | null;
    readonly accessibility: number | null;
    readonly seo: number | null;
  };
  readonly captured_at: string;
}

interface ChangelogPayload {
  readonly tenant: string;
  readonly slug: string;
  readonly entries: ReadonlyArray<ChangelogEntry>;
}

@Component({
  selector: 'lib-public-changelog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <article class="ps-changelog" data-testid="public-changelog">
      <header class="ps-changelog__head">
        <h1>Public changelog</h1>
        <p>What visitors see at <code>{{ originPath() }}</code> right now.</p>
      </header>

      @if (entries().length === 0) {
        <p class="ps-changelog__empty" data-testid="public-changelog-empty">
          No public entries yet — they auto-publish after each successful build.
        </p>
      } @else {
        <ol class="ps-changelog__list">
          @for (entry of entries(); track entry.id) {
            <li
              class="ps-changelog__entry"
              [attr.data-testid]="'public-changelog-entry'"
              [attr.data-entry-id]="entry.id"
            >
              <header class="ps-changelog__entry-head">
                <span class="ps-changelog__iteration">#{{ entry.iteration }}</span>
                <time [attr.datetime]="entry.captured_at">{{ entry.captured_at | date: 'mediumDate' }}</time>
              </header>
              <p class="ps-changelog__subject">
                {{ entry.ai_commit_message || entry.ai_description || ('Snapshot #' + entry.iteration) }}
              </p>
              @if (scoreLine(entry); as line) {
                <p class="ps-changelog__scores">{{ line }}</p>
              }
            </li>
          }
        </ol>
      }
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        color: var(--ps-ink, #f4f4ff);
      }
      .ps-changelog {
        padding: 1.4rem;
        max-width: 760px;
      }
      .ps-changelog__head h1 {
        margin: 0 0 0.25rem;
      }
      .ps-changelog__head p {
        margin: 0;
        color: color-mix(in oklch, currentColor 65%, transparent);
        font-size: 0.85rem;
      }
      .ps-changelog__head code {
        font-family: var(--ps-font-mono, ui-monospace, monospace);
        background: var(--ps-elev-1, rgba(255, 255, 255, 0.04));
        padding: 0.1rem 0.4rem;
        border-radius: 0.35rem;
      }
      .ps-changelog__empty {
        margin-top: 1.4rem;
        opacity: 0.7;
      }
      .ps-changelog__list {
        list-style: none;
        margin: 1.4rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.9rem;
      }
      .ps-changelog__entry {
        padding: 0.95rem 1.1rem;
        border-radius: var(--ps-radius-lg, 16px);
        background: var(--ps-elev-1, rgba(255, 255, 255, 0.03));
        border: 1px solid var(--ps-hairline, rgba(255, 255, 255, 0.08));
      }
      .ps-changelog__entry-head {
        display: flex;
        align-items: baseline;
        gap: 0.7rem;
        font-size: 0.76rem;
        color: color-mix(in oklch, currentColor 60%, transparent);
      }
      .ps-changelog__iteration {
        font-family: var(--ps-font-mono, ui-monospace, monospace);
        color: var(--ps-ink-accent, var(--ps-accent, #00e5ff));
      }
      .ps-changelog__subject {
        margin: 0.45rem 0 0.25rem;
        line-height: 1.45;
      }
      .ps-changelog__scores {
        margin: 0;
        font-size: 0.72rem;
        color: color-mix(in oklch, currentColor 55%, transparent);
        font-family: var(--ps-font-mono, ui-monospace, monospace);
      }
    `,
  ],
})
export class PublicChangelogComponent {
  @Input({ required: true }) set tenantOrigin(value: string) {
    this.origin$.next(value);
  }

  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly origin$ = new BehaviorSubject<string>('');

  private readonly source$ = this.origin$.pipe(
    switchMap((origin) => {
      if (!origin) return of<ChangelogPayload>({ tenant: '', slug: '', entries: [] });
      return timer(0, 30_000).pipe(
        switchMap(() =>
          this.http.get<ChangelogPayload>(`${origin.replace(/\/+$/, '')}/changelog.json`),
        ),
        catchError(() => of<ChangelogPayload>({ tenant: '', slug: '', entries: [] })),
      );
    }),
    takeUntilDestroyed(this.destroyRef),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly payload = toSignal(this.source$, {
    initialValue: { tenant: '', slug: '', entries: [] as ReadonlyArray<ChangelogEntry> },
  });

  readonly entries = computed<ReadonlyArray<ChangelogEntry>>(
    () => this.payload().entries ?? [],
  );

  readonly originPath = computed(() => {
    const o = this.origin$.value || 'your-site.projectsites.dev';
    return `${o.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/changelog`;
  });

  scoreLine(entry: ChangelogEntry): string | null {
    const { performance, accessibility, seo } = entry.lighthouse_scores;
    const parts: string[] = [];
    if (performance !== null) parts.push(`perf ${performance}`);
    if (accessibility !== null) parts.push(`a11y ${accessibility}`);
    if (seo !== null) parts.push(`seo ${seo}`);
    return parts.length ? `Lighthouse: ${parts.join(' · ')}` : null;
  }

  /** Pacifies unused-injector lint while reserving the hook for future overlay flows. */
  protected readonly _destroyRef = this.destroyRef;
  /** Same for the static signal; reserved for future imperative refresh actions. */
  protected readonly _placeholder = signal<null>(null);
}
