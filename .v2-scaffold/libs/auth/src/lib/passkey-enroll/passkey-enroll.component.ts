/**
 * PasskeyEnrollComponent — single-button enroll flow.
 *
 * @remarks
 * Shown inside the security settings drawer. Clicking the CTA invokes
 * `PasskeyService.enrollPasskey$` which orchestrates the WebAuthn
 * registration dance via `@simplewebauthn/browser`.
 *
 * On success: emits a `(enrolled)` event and shows a success message.
 * On failure: surfaces the error inline; never alerts.
 */
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { catchError, of, tap } from 'rxjs';
import { PasskeyService } from '../services/passkey.service.js';

@Component({
  selector: 'lib-passkey-enroll',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonModule, MessageModule],
  templateUrl: './passkey-enroll.component.html',
  styleUrl: './passkey-enroll.component.css',
})
export class PasskeyEnrollComponent {
  private readonly passkey = inject(PasskeyService);

  readonly enrolled = output<{ credential_id: string }>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  enroll(): void {
    this.busy.set(true);
    this.error.set(null);
    this.success.set(null);
    this.passkey
      .enrollPasskey$()
      .pipe(
        tap((result) => {
          this.success.set('Passkey added.');
          this.enrolled.emit(result);
        }),
        catchError((e: unknown) => {
          this.error.set(
            e instanceof HttpErrorResponse
              ? e.error?.message ?? 'Could not add a passkey on this device.'
              : 'Could not add a passkey on this device.',
          );
          return of(null);
        }),
      )
      .subscribe(() => this.busy.set(false));
  }
}
