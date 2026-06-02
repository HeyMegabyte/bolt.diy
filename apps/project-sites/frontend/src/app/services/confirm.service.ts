import { Dialog } from '@angular/cdk/dialog';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { ConfirmDialogData } from '../components/confirm-dialog/confirm-dialog.component';

/**
 * @module services/confirm
 *
 * @description
 * Promise-based replacement for the native `window.confirm()`. Opens the branded
 * {@link ConfirmDialogComponent} in a CDK overlay (focus-trap + Esc + focus
 * restore + dark/cyan tokens) and resolves `true` when the user confirms,
 * `false` when they cancel or dismiss (backdrop / Esc).
 *
 * @remarks
 * The dialog component is lazy-imported so it stays out of the initial bundle.
 * Use this everywhere a destructive admin action needs a confirmation — never
 * `window.confirm()`, which renders an unstyled native dialog (and is blocked in
 * some embedded contexts).
 *
 * @example
 * ```ts
 * private confirm = inject(ConfirmService);
 *
 * async removeMember(m: Member): Promise<void> {
 *   const ok = await this.confirm.confirm({
 *     title: 'Remove member',
 *     message: `Remove ${m.email} from this org? They lose access immediately.`,
 *     confirmLabel: 'Remove',
 *   });
 *   if (!ok) return;
 *   // …perform the removal
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(Dialog);

  /**
   * Open the branded confirmation dialog.
   *
   * @param data - title/message + optional labels and `danger` styling toggle.
   * @returns `true` if confirmed, `false` if cancelled or dismissed.
   */
  async confirm(data: ConfirmDialogData): Promise<boolean> {
    const { ConfirmDialogComponent } = await import(
      '../components/confirm-dialog/confirm-dialog.component'
    );
    const ref = this.dialog.open<boolean>(ConfirmDialogComponent, {
      data,
      panelClass: 'cdk-overlay-transparent',
    });
    const result = await firstValueFrom(ref.closed);
    return result === true;
  }
}
