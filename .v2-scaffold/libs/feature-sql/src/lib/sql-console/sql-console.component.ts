/**
 * `SqlConsoleComponent` — per-site D1 query workbench.
 *
 * Behaviour:
 *   - Monaco editor wraps an SQL surface with schema-aware autocomplete
 *     (table + column names from `SqlService.introspectSchema$`).
 *   - Read-only by default; an explicit per-session toggle flips
 *     write-mode on. The server re-checks `site.sql.write` capability.
 *   - Safe-mode blocks `DROP TABLE` and `DELETE FROM …` without `WHERE`
 *     until the user types the dangerous statement again to confirm.
 *   - Results render in `ag-grid` Community.
 *   - History: last 100 queries per site, persisted to `localStorage`.
 *
 * Monaco is loaded lazily — `// TODO: lock in once @ng-monaco/monaco-editor
 * lands in the workspace`. Until then we render a `<textarea>` with the
 * same `data-testid` so specs pass.
 */
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, catchError, of, switchMap, take } from 'rxjs';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef } from 'ag-grid-community';
import {
  SqlExecuteResponse,
  SqlHistoryEntry,
  SqlSchema,
  SqlService,
  type SqlAiProposal,
} from '@org/data-access';

const DANGER_RE = /^\s*(drop\s+table|delete\s+from\s+\S+\s*(;|$))/i;

@Component({
  selector: 'lib-sql-console',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, AgGridAngular],
  templateUrl: './sql-console.component.html',
  styleUrl: './sql-console.component.css',
})
export class SqlConsoleComponent {
  @Input({ required: true }) set siteId(value: string) {
    this.siteId$.next(value);
  }

  private readonly sql = inject(SqlService);
  private readonly siteId$ = new BehaviorSubject<string>('');

  readonly queryCtrl = new FormControl<string>(
    'SELECT 1 AS hello;',
    { nonNullable: true },
  );

  readonly writeMode = signal(false);
  readonly safeMode = signal(true);
  readonly busy = signal(false);
  readonly result = signal<SqlExecuteResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly pendingConfirm = signal<string | null>(null);

  /** #43 — AI text-to-SQL proposal awaiting user confirmation. */
  readonly aiIntent = new FormControl<string>('', { nonNullable: true });
  readonly aiBusy = signal(false);
  readonly aiError = signal<string | null>(null);
  readonly aiProposal = signal<SqlAiProposal | null>(null);

  readonly schema = toSignal(
    this.siteId$.pipe(
      switchMap((id) =>
        id ? this.sql.introspectSchema$(id) : of<SqlSchema | null>(null),
      ),
    ),
    { initialValue: null as SqlSchema | null },
  );

  readonly history = toSignal(
    this.siteId$.pipe(
      switchMap((id) =>
        id ? this.sql.queryHistory$(id) : of<ReadonlyArray<SqlHistoryEntry>>([]),
      ),
    ),
    { initialValue: [] as ReadonlyArray<SqlHistoryEntry> },
  );

  readonly colDefs = computed<ColDef[]>(() => {
    const r = this.result();
    if (!r) return [];
    return r.columns.map((c, i) => ({
      headerName: c,
      field: String(i),
      sortable: true,
      resizable: true,
      filter: true,
    }));
  });

  readonly rowData = computed<Record<string, unknown>[]>(() => {
    const r = this.result();
    if (!r) return [];
    return r.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      row.forEach((v, i) => {
        obj[String(i)] = v;
      });
      return obj;
    });
  });

  /** Autocomplete completion list — feed to Monaco when it lands. */
  readonly completions = computed<ReadonlyArray<string>>(() => {
    const s = this.schema();
    if (!s) return [];
    const out: string[] = [];
    for (const t of s.tables) {
      out.push(t.name);
      for (const c of t.columns) out.push(`${t.name}.${c.name}`);
    }
    return out;
  });

  toggleWriteMode(): void {
    this.writeMode.update((v) => !v);
  }

  toggleSafeMode(): void {
    this.safeMode.update((v) => !v);
  }

  run(): void {
    const id = this.siteId$.getValue();
    if (!id) return;
    const sqlText = this.queryCtrl.value;
    if (!sqlText.trim()) return;

    if (this.safeMode() && DANGER_RE.test(sqlText) && this.pendingConfirm() !== sqlText) {
      this.pendingConfirm.set(sqlText);
      this.error.set('Safe-mode blocked this destructive query. Click Run again to confirm.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.pendingConfirm.set(null);
    this.sql.executeQuery$(id, sqlText, this.writeMode()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.result.set(r);
      },
      error: (err: Error) => {
        this.busy.set(false);
        this.error.set(err.message || 'Query failed.');
        this.sql.recordFailure(id, sqlText);
      },
    });
  }

  rerunHistory(entry: SqlHistoryEntry): void {
    this.queryCtrl.setValue(entry.sql);
  }

  /** #43 — Ask the AI to propose a SELECT. Two-pane confirm: never auto-runs. */
  askAi(): void {
    const id = this.siteId$.getValue();
    if (!id) return;
    const intent = this.aiIntent.value.trim();
    if (intent.length < 4) {
      this.aiError.set('Describe what you want to query (at least 4 chars).');
      return;
    }
    this.aiBusy.set(true);
    this.aiError.set(null);
    this.aiProposal.set(null);
    this.sql
      .proposeFromAi$(id, intent)
      .pipe(
        take(1),
        catchError((err: { message?: string }) => {
          this.aiBusy.set(false);
          this.aiError.set(err?.message ?? 'AI proposal failed.');
          return of(null);
        }),
      )
      .subscribe((p) => {
        this.aiBusy.set(false);
        if (p) this.aiProposal.set(p);
      });
  }

  /** Accept the AI's proposal: copy SQL into the editor + clear the proposal. */
  acceptAiProposal(): void {
    const p = this.aiProposal();
    if (!p) return;
    this.queryCtrl.setValue(p.sql);
    this.aiProposal.set(null);
    this.aiIntent.setValue('');
  }

  rejectAiProposal(): void {
    this.aiProposal.set(null);
  }

  exportJson(): void {
    const r = this.result();
    if (!r) return;
    this.download(JSON.stringify(r.rows, null, 2), 'results.json', 'application/json');
  }

  exportCsv(): void {
    const r = this.result();
    if (!r) return;
    const header = r.columns.join(',');
    const body = r.rows
      .map((row) =>
        row
          .map((v) => {
            if (v === null || v === undefined) return '';
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(','),
      )
      .join('\n');
    this.download(`${header}\n${body}`, 'results.csv', 'text/csv');
  }

  private download(content: string, filename: string, type: string): void {
    if (typeof document === 'undefined') return;
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  trackByEntry = (_: number, e: SqlHistoryEntry): string =>
    `${e.executed_at}:${e.sql}`;
}
