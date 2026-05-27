/**
 * `BiometricAuthService` — Touch ID / Face ID / Android Biometric Prompt
 * via `@capacitor-community/biometric-auth`, RxJS-first.
 *
 * @remarks
 * Called on app-foreground transitions (see `apps/mobile`'s root
 * component) to gate access to authenticated screens after the OS
 * suspends the app. Falls back to device passcode via
 * `allowDeviceCredential: true` when Touch ID / Face ID enrollment is
 * missing or has been revoked.
 *
 * Web fallback: always emits `true` (the regular auth/session check is
 * the line of defense on the web — biometric is a native-only premium).
 *
 * @example
 * ```ts
 * bio.requireBiometric$('Unlock ProjectSites').subscribe(ok =>
 *   ok ? this.router.navigate(['/dashboard']) : this.router.navigate(['/login']),
 * );
 * ```
 *
 * @see ./capacitor-plugins.ts § BiometricAuthModule
 * @see [[rxjs-first-angular]]
 */
import { Injectable } from '@angular/core';
import { Observable, defer, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { loadBiometricAuth } from './capacitor-plugins';

function detectIsNative(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

@Injectable({ providedIn: 'root' })
export class BiometricAuthService {
  /** `true` when running on iOS or Android via Capacitor. */
  readonly isNative = detectIsNative();

  /**
   * Prompt the user for Touch ID / Face ID. Falls back to device
   * passcode when biometric is unavailable.
   *
   * @param reason - Visible to the user above the prompt.
   * @returns `Observable<boolean>` — emits once: `true` on success,
   *   `false` on cancel / failure / lockout. Never errors.
   */
  requireBiometric$(reason: string): Observable<boolean> {
    if (!this.isNative) {
      return of(true);
    }

    return defer(() => from(loadBiometricAuth())).pipe(
      switchMap((mod) =>
        from(mod.BiometricAuth.checkBiometry()).pipe(
          switchMap((status) => {
            if (!status.isAvailable) {
              // Still attempt authenticate with device-credential fallback.
              return from(
                mod.BiometricAuth.authenticate({
                  reason,
                  allowDeviceCredential: true,
                  iosFallbackTitle: 'Use passcode',
                  androidTitle: 'Unlock ProjectSites',
                  androidSubtitle: reason,
                  cancelTitle: 'Cancel',
                }),
              );
            }
            return from(
              mod.BiometricAuth.authenticate({
                reason,
                allowDeviceCredential: true,
                iosFallbackTitle: 'Use passcode',
                androidTitle: 'Unlock ProjectSites',
                androidSubtitle: reason,
                cancelTitle: 'Cancel',
              }),
            );
          }),
        ),
      ),
      map(() => true),
      catchError(() => of(false)),
    );
  }
}
