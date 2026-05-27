/**
 * `apps/web` shared application config — used by browser bootstrap AND
 * merged into `app.config.server.ts` for SSR. Owned by the apps agent;
 * the dashboard agent owns `app.routes.ts` and must not be merged over.
 *
 * Per `~/.claude/CLAUDE.md` § Frontend Stack and v2 ADR-0002
 * (`Angular 21 + standalone + signals + zoneless`), this file wires:
 *   - zoneless change detection (Angular 21 default)
 *   - View Transitions API + component input binding + scroll restoration
 *   - typed HTTP client + interceptor chain
 *   - PrimeNG theme preset (Sora + brand tokens)
 *   - `provideAppInitializer` `/api/me` warmup, SSR-safe + auth-guarded
 *   - incremental hydration + event replay
 *   - service worker registration (skipped in dev / SSR)
 *   - Sentry as the global `ErrorHandler`
 *
 * @see ./app.config.server.ts
 * @see libs/dashboard for the consumed shell
 */
import {
  ApplicationConfig,
  ErrorHandler,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  inject,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import {
  HttpClient,
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  provideClientHydration,
  withEventReplay,
  withIncrementalHydration,
} from '@angular/platform-browser';
import { provideServiceWorker } from '@angular/service-worker';
import { providePrimeNG } from 'primeng/config';
import { catchError, firstValueFrom, of, timeout } from 'rxjs';

import { appRoutes } from './app.routes';
import { theme as brandTokens } from '@org/ui';
import {
  authInterceptor,
  errorInterceptor,
  tenantInterceptor,
  viewAsInterceptor,
} from './core/interceptors';
import { createSentryErrorHandler, initSentry } from './core/sentry';

/**
 * PrimeNG preset wired to the brand tokens exported by `@org/ui`. Keeps
 * PrimeNG components on-brand (#060610 surface, #00E5FF accent, Sora
 * type) without forking PrimeNG's theme system.
 */
const primeNgPreset = {
  semantic: {
    primary: {
      50: brandTokens.colors.accent.hex,
      500: brandTokens.colors.accent.hex,
      600: brandTokens.colors.accent.hex,
    },
    colorScheme: {
      dark: {
        surface: {
          0: brandTokens.colors.bg.hex,
          50: brandTokens.colors.darkCard.hex,
          100: brandTokens.colors.darkSurface.hex,
        },
      },
    },
  },
} as const;

// Initialise Sentry once, at module load, on the browser only.
if (typeof window !== 'undefined') {
  initSentry();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      appRoutes,
      withViewTransitions(),
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),
    provideHttpClient(
      withFetch(),
      withInterceptors([
        authInterceptor,
        viewAsInterceptor,
        tenantInterceptor,
        errorInterceptor,
      ]),
    ),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: primeNgPreset,
        options: {
          darkModeSelector: '.dark',
          cssLayer: { name: 'primeng', order: 'reset, base, primeng, utilities' },
        },
      },
    }),
    provideAppInitializer(() => {
      // Warm the global `/api/me` cache so the dashboard shell renders
      // role-aware nav on first paint. Guarded for SSR + unauth bootstraps:
      // a 5s timeout + `catchError(() => of(null))` keeps cold loads honest.
      if (typeof fetch === 'undefined') {
        return Promise.resolve();
      }
      const http = inject(HttpClient);
      return firstValueFrom(
        http.get('/api/me').pipe(
          timeout(5000),
          catchError(() => of(null)),
        ),
      );
    }),
    provideClientHydration(withIncrementalHydration(), withEventReplay()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && typeof window !== 'undefined',
      registrationStrategy: 'registerWhenStable:30000',
    }),
    {
      provide: ErrorHandler,
      useFactory: createSentryErrorHandler,
    },
  ],
};
