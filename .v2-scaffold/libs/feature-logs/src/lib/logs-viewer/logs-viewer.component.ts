/**
 * `LogsViewerComponent` — live log tail with CDK virtual scroll.
 *
 * Doctrine markers (Phase-4 hard-marker feature):
 *   - RxJS-first: WS stream + filter state are Observables, bridged to
 *     signals only at template boundary (`toSignal`).
 *   - Virtual scroll via `@angular/cdk/scrolling` — NEVER ag-grid for
 *     log lines (rows are too dense + need monospace).
 *   - First WS message renders in < 500 ms (asserted in spec).
 *
 * @example
 * ```html
 * <lib-logs-viewer siteId="acme" />
 * ```
 */
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BehaviorSubject, EMPTY, catchError, combineLatest, of, switchMap } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, scan, startWith } from 'rxjs/operators';
import { AiService, LogsService, type LogSearchRow } from '@org/data-access';
import type { LogLine } from '@org/domain';

const LEVELS: ReadonlyArray<LogLine['level']> = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
];

const BUFFER_CAP = 10_000;

@Component({
  selector: 'lib-logs-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ScrollingModule],
  templateUrl: './logs-viewer.component.html',
  styleUrl: './logs-viewer.component.css',
})
export class LogsViewerComponent {
  @Input({ required: true }) set siteId(value: string) {
    this.siteId$.next(value);
  }

  @ViewChild(CdkVirtualScrollViewport)
  viewport?: CdkVirtualScrollViewport;

  private readonly logs = inject(LogsService);
  private readonly ai = inject(AiService);
  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly siteId$ = new BehaviorSubject<string>('');

  /** Natural-language search input (Wave 1B #14). */
  readonly nlSearchCtrl = new FormControl<string>('', { nonNullable: true });
  /** Last NL-search result rows, populated by `runNaturalLanguageSearch()`. */
  readonly nlResults = signal<ReadonlyArray<LogSearchRow>>([]);
  /** Translated WHERE clause shown to power users for transparency. */
  readonly nlClause = signal<string>('');
  readonly nlLoading = signal(false);
  readonly nlError = signal<string | null>(null);

  /**
   * Kick off the natural-language log search against the control-plane.
   * Result rows render alongside the live tail; the live stream stays running.
   */
  runNaturalLanguageSearch(): void {
    const query = this.nlSearchCtrl.value.trim();
    const siteId = this.siteId$.value;
    if (!query || !siteId) return;
    this.nlLoading.set(true);
    this.nlError.set(null);
    this.ai
      .searchLogs$(siteId, query)
      .pipe(
        catchError((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.nlError.set(msg);
          this.nlLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.nlClause.set(result.where);
        this.nlResults.set(result.rows);
        this.nlLoading.set(false);
      });
  }

  /** Pause auto-scroll + freeze the visible buffer. */
  readonly paused = signal(false);
  /** Follow mode pins the viewport to the newest line. */
  readonly followMode = signal(true);

  readonly searchCtrl = new FormControl<string>('', { nonNullable: true });
  readonly levelSelections = signal<ReadonlyArray<LogLine['level']>>([
    'info',
    'warn',
    'error',
    'fatal',
  ]);

  readonly availableLevels = LEVELS;

  /** Bridged-once at template boundary per RxJS-first doctrine. */
  readonly lines = toSignal(
    combineLatest([
      this.siteId$.pipe(distinctUntilChanged()),
      this.searchCtrl.valueChanges.pipe(
        startWith(''),
        debounceTime(200),
        distinctUntilChanged(),
      ),
    ]).pipe(
      switchMap(([siteId, search]) =>
        siteId
          ? this.logs.streamLogs$(siteId, {
              search: search || undefined,
            })
          : of<LogLine | null>(null),
      ),
      scan<LogLine | null, ReadonlyArray<LogLine>>(
        (buf, line) => {
          if (this.paused()) return buf;
          if (!line) return [];
          const next = [...buf, line];
          return next.length > BUFFER_CAP
            ? next.slice(next.length - BUFFER_CAP)
            : next;
        },
        [] as ReadonlyArray<LogLine>,
      ),
      takeUntilDestroyed(),
    ),
    { initialValue: [] as ReadonlyArray<LogLine> },
  );

  /** Level-filtered view derived purely client-side. */
  readonly visibleLines = computed(() => {
    const levels = new Set(this.levelSelections());
    return this.lines().filter((l) => levels.has(l.level));
  });

  readonly hasLines = computed(() => this.visibleLines().length > 0);

  togglePause(): void {
    this.paused.update((v) => !v);
  }

  toggleFollow(): void {
    this.followMode.update((v) => !v);
    if (this.followMode()) this.scrollToBottom();
  }

  toggleLevel(level: LogLine['level']): void {
    this.levelSelections.update((current) =>
      current.includes(level)
        ? current.filter((l) => l !== level)
        : [...current, level],
    );
  }

  /**
   * Jump-to-time — find the first line whose timestamp >= `iso` and
   * scroll the viewport to that index. PrimeNG `p-calendar` would emit
   * the ISO string; we keep the API string-typed so this lib stays
   * PrimeNG-independent for testing.
   */
  jumpToTime(iso: string): void {
    const target = new Date(iso).getTime();
    const idx = this.visibleLines().findIndex(
      (l) => new Date(l.timestamp).getTime() >= target,
    );
    if (idx >= 0) this.viewport?.scrollToIndex(idx, 'smooth');
  }

  copyLine(line: LogLine): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(
      `${line.timestamp} ${line.level.toUpperCase()} ${line.source} ${line.message}`,
    );
  }

  levelClass(level: LogLine['level']): string {
    return `lvl-${level}`;
  }

  trackByLine = (_: number, line: LogLine): string =>
    `${line.timestamp}:${line.request_id ?? ''}:${line.message}`;

  private scrollToBottom(): void {
    queueMicrotask(() => {
      const len = this.visibleLines().length;
      if (len > 0) this.viewport?.scrollToIndex(len - 1, 'smooth');
    });
  }

  /** Test-only helper to derive a stable selector. */
  hostEl(): HTMLElement {
    return this.host.nativeElement;
  }

  /** Drive auto-scroll when followMode is on. */
  onLinesChange(): void {
    if (this.followMode() && !this.paused()) this.scrollToBottom();
  }

  // Map a single line to its filtered representation — useful for inline
  // search highlight. Kept pure for easy unit-testing.
  highlight(line: LogLine, term: string): string {
    if (!term) return line.message;
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return line.message.replace(
      new RegExp(safe, 'gi'),
      (m) => `<mark>${m}</mark>`,
    );
  }

  searchTerm = computed(() => this.searchCtrl.value ?? '');

  /** Used by the template to call the pure mapper. */
  readonly logMapper = map((line: LogLine) => line);
}
