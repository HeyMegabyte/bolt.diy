/**
 * `apps/mobile` root component — Ionic shell with a single router outlet.
 *
 * @remarks
 * Wires:
 *  - `BiometricAuthService` → prompts Touch ID / Face ID every time the
 *    app returns to the foreground (Capacitor `App.addListener
 *    ('appStateChange', ...)`). Falls back to device passcode when
 *    biometric is unavailable. On `false`, navigates to `/login`.
 *  - `OfflineQueueService` is bootstrapped (constructor wires the
 *    `online` listener) just by `inject()`-ing it.
 *
 * The dashboard shell from `@org/dashboard` renders inside the outlet so
 * feature parity with `apps/web` is automatic.
 */
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { BiometricAuthService, OfflineQueueService } from '@org/util-platform';
import { Observable, Subject, defer, from, of } from 'rxjs';
import { catchError, filter, switchMap, takeUntil } from 'rxjs/operators';

interface CapacitorAppListenerHandle {
  readonly remove: () => Promise<void>;
}
interface CapacitorAppPlugin {
  addListener(
    eventName: 'appStateChange',
    handler: (state: { isActive: boolean }) => void,
  ): Promise<CapacitorAppListenerHandle>;
}

async function loadCapacitorApp(): Promise<CapacitorAppPlugin | null> {
  try {
    const mod = (await import(/* @vite-ignore */ '@capacitor/app' as string)) as {
      App: CapacitorAppPlugin;
    };
    return mod.App;
  } catch {
    return null;
  }
}

function appStateChange$(app: CapacitorAppPlugin): Observable<boolean> {
  return new Observable<boolean>((sub) => {
    let handle: CapacitorAppListenerHandle | undefined;
    app
      .addListener('appStateChange', (s) => sub.next(s.isActive))
      .then((h) => (handle = h))
      .catch((err) => sub.error(err));
    return () => {
      handle?.remove().catch(() => undefined);
    };
  });
}

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet, RouterModule],
  template: `<ion-app><ion-router-outlet /></ion-app>`,
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected title = 'ProjectSites';
  private readonly bio = inject(BiometricAuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Side-effect: instantiating the queue installs its `online` listener.
  private readonly offlineQueue = inject(OfflineQueueService);

  private readonly destroyed$ = new Subject<void>();

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.destroyed$.next();
      this.destroyed$.complete();
    });

    if (this.offlineQueue.isOnline()) {
      this.offlineQueue.flush$().subscribe();
    }

    if (!this.bio.isNative) {
      return;
    }

    defer(() => from(loadCapacitorApp()))
      .pipe(
        switchMap((app) => (app ? appStateChange$(app) : of<boolean>(false))),
        filter((isActive) => isActive === true),
        switchMap(() => this.bio.requireBiometric$('Unlock ProjectSites')),
        catchError(() => of(true)),
        takeUntil(this.destroyed$),
      )
      .subscribe((ok) => {
        if (!ok) this.router.navigate(['/login']);
      });

    // Cold-boot prompt.
    this.bio
      .requireBiometric$('Unlock ProjectSites')
      .pipe(
        catchError(() => of(true)),
        takeUntil(this.destroyed$),
      )
      .subscribe((ok) => {
        if (!ok) this.router.navigate(['/login']);
      });
  }
}
