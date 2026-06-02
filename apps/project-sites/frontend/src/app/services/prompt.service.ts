import { Dialog } from '@angular/cdk/dialog';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type { InputDialogData } from '../components/input-dialog/input-dialog.component';

/**
 * @module services/prompt
 *
 * @description
 * Promise-based replacement for the native `window.prompt()`. Opens the branded
 * {@link InputDialogComponent} in a CDK overlay (focus-trap + Esc + focus restore
 * + dark/cyan tokens + inline validation) and resolves the trimmed string the
 * user entered, or `null` when they cancel / dismiss (backdrop / Esc).
 *
 * @remarks
 * The dialog component is lazy-imported so it stays out of the initial bundle.
 * Use this everywhere a free-text input is needed — never `window.prompt()`,
 * which renders an unstyled native dialog (and is blocked in some embedded
 * contexts).
 *
 * @example
 * ```ts
 * private promptSvc = inject(PromptService);
 *
 * async bindHostname(): Promise<void> {
 *   const host = await this.promptSvc.prompt({
 *     title: 'Bind hostname',
 *     label: 'Hostname',
 *     placeholder: 'shop.example.com',
 *     validate: (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : 'Enter a valid hostname'),
 *   });
 *   if (!host) return;
 *   // …use host
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class PromptService {
  private readonly dialog = inject(Dialog);

  /**
   * Open the branded input dialog.
   *
   * @param data - title + optional message/label/placeholder/initial value/validator.
   * @returns the trimmed entered string, or `null` if cancelled / dismissed.
   */
  async prompt(data: InputDialogData): Promise<string | null> {
    const { InputDialogComponent } = await import(
      '../components/input-dialog/input-dialog.component'
    );
    const ref = this.dialog.open<string | null>(InputDialogComponent, {
      data,
      panelClass: 'cdk-overlay-transparent',
    });
    const result = await firstValueFrom(ref.closed);
    return result ?? null;
  }
}
