/**
 * TotpEnrollComponent — 3-step TOTP enrollment.
 *
 * @remarks
 * Step 1 — request a challenge (server mints secret + otpauth URL + backup codes).
 * Step 2 — render the QR via `qrcode` and show backup codes ONCE.
 * Step 3 — user types the first 6-digit code from their authenticator;
 *           server confirms it; account flips `totp_enabled = 1`.
 *
 * Backup codes are surfaced only once. If the user closes the panel
 * without copying them, the next visit will require re-enrollment.
 */
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { catchError, of, tap } from 'rxjs';
import QRCode from 'qrcode';
import { TotpService, type TotpEnrollChallenge } from '../services/totp.service.js';

type Stage = 'idle' | 'challenge' | 'verify' | 'done';

@Component({
  selector: 'lib-totp-enroll',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    MessageModule,
    ProgressSpinnerModule,
  ],
  templateUrl: './totp-enroll.component.html',
  styleUrl: './totp-enroll.component.css',
})
export class TotpEnrollComponent implements AfterViewInit {
  private readonly totp = inject(TotpService);

  readonly stage = signal<Stage>('idle');
  readonly challenge = signal<TotpEnrollChallenge | null>(null);
  readonly code = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly qrCanvas = viewChild<ElementRef<HTMLCanvasElement>>('qrCanvas');

  ngAfterViewInit(): void {
    void this.renderQrIfReady();
  }

  start(): void {
    this.busy.set(true);
    this.error.set(null);
    this.totp
      .enrollTotp$()
      .pipe(
        tap((c) => {
          this.challenge.set(c);
          this.stage.set('challenge');
          // Render after the canvas exists in the DOM.
          queueMicrotask(() => void this.renderQrIfReady());
        }),
        catchError((e: unknown) => {
          this.error.set(
            e instanceof HttpErrorResponse
              ? e.error?.message ?? 'Could not start enrollment.'
              : 'Could not start enrollment.',
          );
          return of(null);
        }),
      )
      .subscribe(() => this.busy.set(false));
  }

  proceedToVerify(): void {
    this.stage.set('verify');
  }

  verify(): void {
    const v = this.code().trim();
    if (!v) return;
    this.busy.set(true);
    this.error.set(null);
    this.totp
      .verifyTotp$(v)
      .pipe(
        tap(() => this.stage.set('done')),
        catchError((e: unknown) => {
          this.error.set(
            e instanceof HttpErrorResponse
              ? e.error?.message ?? 'That code didn’t match. Try again.'
              : 'That code didn’t match. Try again.',
          );
          return of(null);
        }),
      )
      .subscribe(() => this.busy.set(false));
  }

  private async renderQrIfReady(): Promise<void> {
    const c = this.challenge();
    const canvas = this.qrCanvas()?.nativeElement;
    if (!c || !canvas) return;
    try {
      await QRCode.toCanvas(canvas, c.otpauth_url, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 220,
      });
    } catch {
      this.error.set('Could not render the QR. Use the manual secret instead.');
    }
  }
}
