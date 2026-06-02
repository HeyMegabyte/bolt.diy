import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DialogShellComponent } from '../dialog-shell/dialog-shell.component';

/**
 * Data contract for {@link InputDialogComponent}. Opened via
 * {@link PromptService.prompt}, never directly.
 */
export interface InputDialogData {
  /** Dialog heading (e.g. "Bind hostname"). */
  title: string;
  /** Optional explanatory prose above the field. */
  message?: string;
  /** Field label. */
  label?: string;
  /** Input placeholder. */
  placeholder?: string;
  /** Pre-filled value. */
  initialValue?: string;
  /** Confirm button label. Defaults to "Save". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Optional synchronous validator. Return an error string to block submission
   * (shown inline), or `null`/`undefined` when the trimmed value is acceptable.
   */
  validate?: (value: string) => string | null | undefined;
}

/**
 * Generic branded text-input dialog — the Spartan replacement for the native
 * `window.prompt()`. Renders inside {@link DialogShellComponent} (CDK overlay) so
 * it inherits focus-trap, Esc-to-close, focus-restore, and the dark/cyan tokens.
 * Resolves the {@link DialogRef} with the trimmed string on submit, or `null` on
 * cancel / dismiss.
 *
 * @remarks
 * Do not open this directly — use {@link PromptService.prompt}, which returns a
 * `Promise<string | null>` and handles the lazy import + result mapping.
 */
@Component({
  imports: [DialogShellComponent, FormsModule],
  selector: 'app-input-dialog',
  standalone: true,
  template: `
    <app-dialog-shell (closed)="dialogRef.close(null)">
      <span dialogIcon>
        <svg
          class="text-[color:var(--ps-accent,#00e5ff)]"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </span>
      <span dialogTitle>{{ data.title }}</span>

      <div class="p-6 space-y-3">
        @if (data.message) {
          <p class="text-[0.84rem] text-text-secondary leading-relaxed">{{ data.message }}</p>
        }
        @if (data.label) {
          <label class="block text-[0.74rem] font-medium text-text-secondary" [attr.for]="'input-dialog-field'">
            {{ data.label }}
          </label>
        }
        <input
          id="input-dialog-field"
          type="text"
          class="w-full rounded-xl bg-white/[0.04] border border-white/[0.1] px-3.5 py-2.5 text-[0.9rem] text-white placeholder:text-text-secondary/60 outline-none focus:border-[color:var(--ps-accent,#00e5ff)]/50 focus:bg-white/[0.06] transition-colors"
          [class.border-red-500]="error()"
          [placeholder]="data.placeholder ?? ''"
          [(ngModel)]="value"
          (keydown.enter)="submit()"
          [attr.aria-invalid]="!!error()"
          [attr.aria-describedby]="error() ? 'input-dialog-error' : null"
          data-testid="input-dialog-field"
          cdkFocusInitial
        />
        @if (error(); as e) {
          <p id="input-dialog-error" class="text-[0.72rem] text-red-400" data-testid="input-dialog-error">
            {{ e }}
          </p>
        }
      </div>

      <div
        dialogFooter
        class="px-6 py-4 border-t border-white/[0.06] flex items-center justify-end gap-3"
      >
        <button class="btn-ghost text-sm" (click)="dialogRef.close(null)" data-testid="input-dialog-cancel">
          {{ data.cancelLabel ?? 'Cancel' }}
        </button>
        <button
          class="px-5 py-2 rounded-xl bg-[color:var(--ps-accent,#00e5ff)]/20 text-[color:var(--ps-accent,#00e5ff)] font-semibold text-sm border border-[color:var(--ps-accent,#00e5ff)]/30 hover:bg-[color:var(--ps-accent,#00e5ff)]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          [disabled]="!canSubmit()"
          (click)="submit()"
          data-testid="input-dialog-submit"
        >
          {{ data.confirmLabel ?? 'Save' }}
        </button>
      </div>
    </app-dialog-shell>
  `,
})
export class InputDialogComponent {
  readonly data = inject<InputDialogData>(DIALOG_DATA);
  readonly dialogRef = inject<DialogRef<string | null>>(DialogRef);

  readonly value = signal(this.data.initialValue ?? '');
  readonly error = computed(() => {
    const trimmed = this.value().trim();
    if (!trimmed) return null; // empty is "not yet valid" but not an error to show
    return this.data.validate?.(trimmed) ?? null;
  });
  readonly canSubmit = computed(() => {
    const trimmed = this.value().trim();
    return trimmed.length > 0 && !this.data.validate?.(trimmed);
  });

  submit(): void {
    const trimmed = this.value().trim();
    if (!trimmed || this.data.validate?.(trimmed)) return;
    this.dialogRef.close(trimmed);
  }
}
