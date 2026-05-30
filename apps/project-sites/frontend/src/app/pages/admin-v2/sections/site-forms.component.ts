/**
 * @module pages/admin-v2/sections/site-forms
 *
 * Per-site Forms — a SITE-group editor section driven by the topbar Project
 * dropdown ({@link V2SiteContextService.selectedSite}), NOT a `:id` route. This
 * is the pattern for the per-site editor surfaces the main view is built from:
 * the section reacts to whichever Project is selected and shows that site's
 * form submissions (name / email / payload preview / relative time). 4-state on
 * helm primitives per [[spartan-ui-design-system]].
 *
 * @example Routed as `site/forms` under `/admin/v2`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService, type FormSubmission } from '../../../services/api.service';
import {
  HlmButtonDirective,
  HlmCardDirective,
  HlmCardTitleDirective,
  HlmCardDescriptionDirective,
} from '../../../ui';
import { RelativeDatePipe } from './relative-date.pipe';
import { V2SiteContextService } from '../v2-site-context.service';

type FormsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: FormSubmission[] };

@Component({
  selector: 'app-v2-site-forms',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonDirective,
    HlmCardDirective,
    HlmCardTitleDirective,
    HlmCardDescriptionDirective,
    RelativeDatePipe,
  ],
  template: `
    @if (!ctx.selectedSite()) {
      <div hlmCard class="max-w-md mx-auto mt-16 text-center" data-testid="v2-site-forms-nosite">
        <h3 hlmCardTitle>No site selected</h3>
        <p hlmCardDescription class="mt-1">Pick a project from the dropdown above to view its form submissions.</p>
      </div>
    } @else {
      <div class="mb-3">
        <h2 class="text-lg font-semibold text-foreground">Form submissions</h2>
        <p class="text-sm text-muted-foreground">{{ ctx.selectedSite()!.business_name }}</p>
      </div>

      @switch (state().status) {
        @case ('loading') {
          <div class="flex flex-col gap-2" data-testid="v2-site-forms-loading">
            @for (s of [0,1,2]; track s) { <div hlmCard class="h-14 animate-pulse opacity-60"></div> }
          </div>
        }
        @case ('error') {
          <div hlmCard class="max-w-md mx-auto mt-12 text-center" role="alert" data-testid="v2-site-forms-error">
            <h3 hlmCardTitle>Couldn't load submissions</h3>
            <p hlmCardDescription class="mt-1">{{ errMsg() }}</p>
            <button hlmBtn variant="secondary" size="sm" class="mt-3" (click)="reload()">Retry</button>
          </div>
        }
        @case ('ready') {
          @if (rows().length === 0) {
            <div hlmCard class="text-center py-8" data-testid="v2-site-forms-empty">
              <p hlmCardDescription>No submissions yet for this site.</p>
            </div>
          } @else {
            <ul hlmCard class="p-0 divide-y divide-border/50" data-testid="v2-site-forms-list">
              @for (f of rows(); track f.id) {
                <li class="px-3 py-2 text-sm" data-testid="v2-site-forms-row">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-medium text-foreground truncate">{{ f.form_name || 'submission' }}</span>
                    <span class="text-xs text-muted-foreground shrink-0 tabular-nums" [title]="f.created_at">{{ f.created_at | relativeDate }}</span>
                  </div>
                  @if (f.email) { <p class="text-xs text-muted-foreground mt-0.5 truncate">{{ f.email }}</p> }
                  @if (preview(f); as p) { <p class="text-xs text-muted-foreground/80 mt-0.5 truncate font-mono">{{ p }}</p> }
                </li>
              }
            </ul>
          }
        }
      }
    }
  `,
})
export class V2SiteFormsComponent {
  private readonly api = inject(ApiService);
  protected readonly ctx = inject(V2SiteContextService);

  /** Submissions for the selected Project, reactive on the dropdown. */
  protected readonly state = toSignal(
    toObservable(this.ctx.selectedSite).pipe(
      switchMap((site) =>
        site
          ? this.api.listFormSubmissions(site.id, 50).pipe(
              map((r) => ({ status: 'ready', rows: r.data ?? [] }) as FormsState),
              startWith({ status: 'loading' } as FormsState),
              catchError((e: unknown) =>
                of({ status: 'error', message: (e as { message?: string })?.message ?? 'Network error' } as FormsState),
              ),
            )
          : of({ status: 'ready', rows: [] } as FormsState),
      ),
    ),
    { initialValue: { status: 'loading' } as FormsState },
  );

  protected readonly rows = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.rows : [];
  });
  protected readonly errMsg = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  /** A compact one-line preview of the submission payload. */
  protected preview(f: FormSubmission): string {
    const entries = Object.entries(f.payload ?? {})
      .filter(([k]) => k !== 'email' && k !== 'form_name')
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`);
    return entries.join(' · ');
  }

  protected reload(): void {
    location.reload();
  }
}
