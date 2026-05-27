/**
 * `PlatformService` — Capacitor / native-API capability wrappers, RxJS-first.
 *
 * @remarks
 * Every operation returns an `Observable<T>` so consumers compose with the
 * rest of the RxJS-first stack ([[rxjs-first-angular]]). The `Capacitor`
 * runtime check guards the native branch; the web branch uses the
 * standard browser API (`<input type=file>`, `navigator.geolocation`,
 * `Notification.requestPermission`, `navigator.vibrate`).
 *
 * Capacitor plugins (`@capacitor/camera`, `@capacitor/geolocation`,
 * `@capacitor/push-notifications`, `@capacitor/haptics`) are imported
 * lazily via the dynamic-import helpers in `./capacitor-plugins.ts`
 * which carry their own ambient typings. The lazy-import keeps SSR safe
 * (the dynamic `import()` never evaluates at server-render time) AND
 * lets the web bundle compile cleanly when the optional plugin packages
 * aren't installed.
 *
 * @example
 * ```ts
 * platform.takePhoto$().subscribe(photo => this.uploadPhoto(photo.dataUrl));
 * platform.haptic$('success').subscribe();
 * ```
 *
 * @see ../README.md
 * @see ./capacitor-plugins.ts
 */
import { Injectable } from '@angular/core';
import { defer, from, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  loadCamera,
  loadGeolocation,
  loadHaptics,
  loadPushNotifications,
} from './capacitor-plugins';
import type {
  HapticImpact,
  HapticResult,
  LocationResult,
  PhotoResult,
  PushPermissionResult,
} from './platform.types';

/* ------------------------------------------------------------------ */
/* Runtime capability checks                                           */
/* ------------------------------------------------------------------ */

/**
 * Detect Capacitor native runtime without importing `@capacitor/core`
 * synchronously — the package is only present in `apps/mobile`'s build
 * graph. We sniff the global Capacitor object the runtime injects.
 */
function detectIsNative(): boolean {
  if (typeof globalThis === 'undefined') {
    return false;
  }
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

@Injectable({ providedIn: 'root' })
export class PlatformService {
  /** `true` when running on iOS or Android via Capacitor. */
  readonly isNative = detectIsNative();

  /* ----------------------------------------------------------- */
  /* Camera / photo                                              */
  /* ----------------------------------------------------------- */

  /**
   * Take or pick a photo.
   *
   * @returns `Observable<PhotoResult>` — emits once, then completes.
   * @throws The observable errors when permission is denied OR no file is selected on web.
   */
  takePhoto$(): Observable<PhotoResult> {
    if (this.isNative) {
      return defer(() => from(loadCamera())).pipe(
        switchMap((mod) =>
          from(
            mod.Camera.getPhoto({
              quality: 88,
              allowEditing: false,
              resultType: mod.CameraResultType.DataUrl,
              source: mod.CameraSource.Prompt,
              webUseInput: true,
            }),
          ),
        ),
        map((res) => ({
          dataUrl: res.dataUrl ?? '',
          format: (res.format as PhotoResult['format']) || 'jpeg',
          source: 'native' as const,
        })),
      );
    }

    if (!isBrowser()) {
      return throwError(() => new Error('takePhoto$: not available on the server'));
    }

    return defer(() => from(pickFileWeb('image/*'))).pipe(
      switchMap((file) => from(readFileAsDataUrl(file))),
      map((dataUrl) => ({
        dataUrl,
        format: 'jpeg' as const,
        source: 'web' as const,
      })),
    );
  }

  /* ----------------------------------------------------------- */
  /* Geolocation                                                  */
  /* ----------------------------------------------------------- */

  /**
   * Resolve the device's current location.
   *
   * @returns `Observable<LocationResult>` — emits once, then completes.
   */
  getCurrentLocation$(): Observable<LocationResult> {
    if (this.isNative) {
      return defer(() => from(loadGeolocation())).pipe(
        switchMap((mod) =>
          from(mod.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10_000 })),
        ),
        map((pos) => ({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
          source: 'native' as const,
        })),
      );
    }

    if (!isBrowser() || !('geolocation' in navigator)) {
      return throwError(() => new Error('getCurrentLocation$: geolocation unsupported'));
    }

    return new Observable<LocationResult>((subscriber) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          subscriber.next({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            timestamp: pos.timestamp,
            source: 'web',
          });
          subscriber.complete();
        },
        (err) => subscriber.error(err),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
      return () => {
        /* getCurrentPosition cannot be cancelled; leave empty. */
      };
    });
  }

  /* ----------------------------------------------------------- */
  /* Push notifications                                           */
  /* ----------------------------------------------------------- */

  /**
   * Request permission to send push notifications.
   *
   * @returns `Observable<PushPermissionResult>` — emits once, then completes.
   */
  requestPushPermission$(): Observable<PushPermissionResult> {
    if (this.isNative) {
      return defer(() => from(loadPushNotifications())).pipe(
        switchMap((mod) =>
          from(mod.PushNotifications.requestPermissions()).pipe(
            switchMap((perm) => {
              if (perm.receive !== 'granted') {
                return of<PushPermissionResult>({ status: 'denied', source: 'native' });
              }
              return from(mod.PushNotifications.register()).pipe(
                map(() => ({ status: 'granted' as const, source: 'native' as const })),
              );
            }),
          ),
        ),
        catchError(() => of<PushPermissionResult>({ status: 'denied', source: 'native' })),
      );
    }

    if (!isBrowser() || !('Notification' in window)) {
      return of<PushPermissionResult>({ status: 'unsupported', source: 'unsupported' });
    }

    return defer(() => from(Notification.requestPermission())).pipe(
      map((perm) => ({
        status: (perm === 'granted'
          ? 'granted'
          : perm === 'denied'
            ? 'denied'
            : 'prompt') as PushPermissionResult['status'],
        source: 'web' as const,
      })),
    );
  }

  /* ----------------------------------------------------------- */
  /* Haptics                                                      */
  /* ----------------------------------------------------------- */

  /**
   * Fire a haptic-feedback pulse. Silent no-op on browsers that lack
   * `navigator.vibrate`.
   *
   * @param impact - one of `light` `medium` `heavy` `selection` `success` `warning` `error`.
   */
  haptic$(impact: HapticImpact = 'light'): Observable<HapticResult> {
    if (this.isNative) {
      return defer(() => from(loadHaptics())).pipe(
        switchMap((mod) => {
          if (impact === 'success' || impact === 'warning' || impact === 'error') {
            const notificationMap = {
              success: mod.NotificationType.Success,
              warning: mod.NotificationType.Warning,
              error: mod.NotificationType.Error,
            } as const;
            return from(mod.Haptics.notification({ type: notificationMap[impact] }));
          }
          if (impact === 'selection') {
            return from(mod.Haptics.selectionStart());
          }
          const styleMap = {
            light: mod.ImpactStyle.Light,
            medium: mod.ImpactStyle.Medium,
            heavy: mod.ImpactStyle.Heavy,
          } as const;
          return from(mod.Haptics.impact({ style: styleMap[impact] }));
        }),
        map(() => ({ fired: true, source: 'native' as const })),
        catchError(() => of<HapticResult>({ fired: false, source: 'native' })),
      );
    }

    if (!isBrowser() || typeof navigator.vibrate !== 'function') {
      return of<HapticResult>({ fired: false, source: 'unsupported' });
    }

    const duration: Record<HapticImpact, number> = {
      light: 10,
      medium: 25,
      heavy: 60,
      selection: 8,
      success: 30,
      warning: 50,
      error: 80,
    };
    const fired = navigator.vibrate(duration[impact]);
    return of<HapticResult>({ fired, source: 'web' });
  }
}

/* ------------------------------------------------------------------ */
/* Web fallback helpers                                                */
/* ------------------------------------------------------------------ */

function pickFileWeb(accept: string): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        resolve(file);
      } else {
        reject(new Error('no file selected'));
      }
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
