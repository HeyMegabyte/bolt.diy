import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';

import { DialogShellComponent } from '../dialog-shell/dialog-shell.component';

/**
 * Data contract for {@link ConfirmDialogComponent}. Opened via
 * {@link ConfirmService.confirm}, never directly.
 */
export interface ConfirmDialogData {
  /** Dialog heading (e.g. "Delete endpoint"). */
  title: string;
  /** Body prose explaining the consequence. Plain text — not HTML. */
  message: string;
  /** Confirm button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Render the confirm button in the destructive (red) style. Default true. */
  danger?: boolean;
}

/**
 * Generic branded confirmation dialog — the Spartan replacement for the native
 * `window.confirm()`. Renders inside {@link DialogShellComponent} (CDK overlay)
 * so it inherits focus-trap, Esc-to-close, focus-restore, and the dark/cyan
 * design tokens. Resolves the {@link DialogRef} with `true` (confirmed) or
 * `false` (cancelled / dismissed).
 *
 * @remarks
 * Do not open this directly — use {@link ConfirmService.confirm}, which returns
 * a `Promise<boolean>` and handles the lazy import + result mapping.
 *
 * @example
 * ```ts
 * if (await this.confirm.confirm({ title: 'Delete?', message: 'Cannot be undone.' })) {
 *   this.doDelete();
 * }
 * ```
 */
@Component({
  imports: [DialogShellComponent],
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
    <app-dialog-shell (closed)="dialogRef.close(false)">
      <span dialogIcon>
        @if (data.danger ?? true) {
          <svg
            class="text-red-400"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        } @else {
          <svg
            class="text-[color:var(--ps-accent,#00e5ff)]"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        }
      </span>
      <span dialogTitle>{{ data.title }}</span>

      <div class="p-6">
        <p class="text-[0.88rem] text-text-secondary leading-relaxed" data-testid="confirm-message">
          {{ data.message }}
        </p>
      </div>

      <div
        dialogFooter
        class="px-6 py-4 border-t border-white/[0.06] flex items-center justify-end gap-3"
      >
        <button class="btn-ghost text-sm" (click)="dialogRef.close(false)" data-testid="confirm-cancel">
          {{ data.cancelLabel ?? 'Cancel' }}
        </button>
        <button
          [class]="confirmClass"
          (click)="dialogRef.close(true)"
          data-testid="confirm-accept"
          cdkFocusInitial
        >
          {{ data.confirmLabel ?? 'Confirm' }}
        </button>
      </div>
    </app-dialog-shell>
  `,
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmDialogData>(DIALOG_DATA);
  readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);

  protected get confirmClass(): string {
    return (this.data.danger ?? true)
      ? 'px-5 py-2 rounded-xl bg-red-500/20 text-red-400 font-semibold text-sm border border-red-500/20 hover:bg-red-500/30 hover:border-red-500/30 transition-all'
      : 'px-5 py-2 rounded-xl bg-[color:var(--ps-accent,#00e5ff)]/20 text-[color:var(--ps-accent,#00e5ff)] font-semibold text-sm border border-[color:var(--ps-accent,#00e5ff)]/30 hover:bg-[color:var(--ps-accent,#00e5ff)]/30 transition-all';
  }
}
