/**
 * `apps/mobile` application config — Ionic + Capacitor shell that mounts
 * the same `@org/dashboard` routes as `apps/web`. Native APIs (camera,
 * geolocation, push, haptics) sit behind `@org/util-platform` capability
 * checks so the same code paths work in iOS / Android / web preview.
 *
 * Per `~/.claude/CLAUDE.md` § Frontend Stack and `[[rxjs-first-angular]]`,
 * we ship:
 *   - zoneless change detection (Angular 21 default)
 *   - HTTP client with the same interceptor chain as web
 *   - PrimeNG theme preset (consistent with `apps/web`)
 *   - Ionic in iOS mode for premium feel even on Android (single visual
 *     identity per Brian's preference; matches the Cupertino-leaning
 *     ProjectSites brand)
 *
 * @see ../../web/src/app/app.config.ts
 */
import {
  ApplicationConfig,
  ErrorHandler,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { providePrimeNG } from 'primeng/config';
import { theme as brandTokens } from '@org/ui';
import { appRoutes } from './app.routes';

/**
 * PrimeNG preset bound to the brand tokens — matches `apps/web` so the
 * design system is one ledger across surfaces.
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

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideIonicAngular({
      mode: 'ios',
      animated: true,
      hardwareBackButton: true,
      rippleEffect: false,
      sanitizerEnabled: true,
    }),
    provideRouter(
      appRoutes,
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),
    provideHttpClient(withFetch(), withInterceptors([])),
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
      // No-op for now; reserved for `@org/util-platform` capability
      // bootstrapping (push-permission, deep-link handling).
      return Promise.resolve();
    }),
    {
      provide: ErrorHandler,
      useClass: ErrorHandler,
    },
  ],
};
