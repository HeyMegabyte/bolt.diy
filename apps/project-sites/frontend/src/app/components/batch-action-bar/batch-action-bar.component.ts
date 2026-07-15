import { Component, input, output, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-batch-action-bar',
  standalone: true,
  imports: [NgClass],
  template: `
    @if (selectedCount() > 0) {
      <div class="batch-bar" [class.visible]="selectedCount() > 0">
        <span class="batch-count">{{ selectedCount() }} selected</span>
        <button class="batch-btn" (click)="doAction('rebuild')">🔄 Rebuild All</button>
        <button class="batch-btn" (click)="doAction('snapshot')">📸 Snapshot All</button>
        <button class="batch-btn batch-btn--danger" (click)="doAction('delete')">🗑 Delete All</button>
        <button class="batch-btn batch-btn--ghost" (click)="clear.emit()">✕ Clear</button>
      </div>
    }
  `,
  styles: [`
    .batch-bar { position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%) translateY(120%);
      background: var(--ps-bg, #060610); border: 1px solid var(--ps-accent, #00E5FF);
      border-radius: var(--ps-radius-xl, 22px); padding: .75rem 1.5rem; display: flex;
      align-items: center; gap: .75rem; z-index: 100000;
      box-shadow: 0 8px 32px rgba(0,229,255,.15); transition: transform .2s ease; }
    .batch-bar.visible { transform: translateX(-50%) translateY(0); }
    .batch-count { font-family: monospace; font-size: .82rem; color: var(--ps-accent); margin-right: .5rem; }
    .batch-btn { background: rgba(0,229,255,.1); border: 1px solid rgba(0,229,255,.2); color: #f4f4ff;
      padding: .4rem .9rem; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: .82rem; }
    .batch-btn:hover { background: rgba(0,229,255,.2); }
    .batch-btn--danger { border-color: rgba(239,68,68,.3); background: rgba(239,68,68,.08); }
    .batch-btn--danger:hover { border-color: rgb(239,68,68); background: rgba(239,68,68,.15); }
    .batch-btn--ghost { background: transparent; border-color: transparent; }
  `],
})
export class BatchActionBarComponent {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly selectedIds = input.required<string[]>();
  readonly selectedCount = input.required<number>();
  readonly clear = output<void>();
  readonly confirmed = output<{ siteIds: string[]; action: string }>();

  doAction(action: string): void {
    const ids = this.selectedIds();
    this.api.post('/batch', { siteIds: ids, action }).subscribe({
      next: (res: unknown) => {
        const r = res as { summary?: { ok?: number; failed?: number } };
        this.toast.show(`${action}: ${r.summary?.ok ?? 0} ok, ${r.summary?.failed ?? 0} failed`, r.summary?.failed ? 'warning' : 'success');
        this.confirmed.emit({ siteIds: ids, action });
      },
      error: (err: unknown) => this.toast.show(`Batch ${action} failed`, 'error'),
    });
  }
}
