import { type ApplicationConfig, APP_INITIALIZER, ErrorHandler, Injector, importProvidersFrom, inject, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { PreloadAllModules, provideRouter, Router, withPreloading, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideServiceWorker } from '@angular/service-worker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { providePrimeNG } from 'primeng/config';
import * as Sentry from '@sentry/angular';
import { routes } from './app.routes';
import { CockpitPreset } from './theme/cockpit-preset';
import { firstValueFrom } from 'rxjs';
import { GlobalErrorHandler } from './services/error-handler.service';
import { initSentryEarly, SentryService } from './services/sentry.service';
import { retryInterceptor } from './interceptors/retry.interceptor';
import { loadingInterceptor } from './interceptors/loading.interceptor';
import { sentryBreadcrumbInterceptor } from './interceptors/sentry-breadcrumb.interceptor';

/**
 * Initialize Sentry BEFORE Angular bootstrap so the SDK is ready when the
 * router + ErrorHandler integrations attach. Idempotent — safe in tests.
 */
initSentryEarly();

/** Preload translations before the app renders — prevents flash of raw keys.
 * Priority: localStorage > ?lang= query param > browser language > 'en' */
function initTranslations(translate: TranslateService) {
  return () => {
    translate.setFallbackLang('en');

    const stored = localStorage.getItem('ps_language');
    if (stored === 'en' || stored === 'es') {
      return firstValueFrom(translate.use(stored));
    }

    const urlLang = new URLSearchParams(window.location.search).get('lang');
    if (urlLang === 'en' || urlLang === 'es') {
      localStorage.setItem('ps_language', urlLang);
      return firstValueFrom(translate.use(urlLang));
    }

    const browserLang = translate.getBrowserLang();
    const lang = browserLang === 'es' ? 'es' : 'en';
    return firstValueFrom(translate.use(lang));
  };
}

/**
 * Composite ErrorHandler: forwards to the existing GlobalErrorHandler (toasts +
 * structured logs + section-error-bus) AND to `Sentry.createErrorHandler()` so
 * every unhandled exception reaches Sentry even when the DI-injected
 * SentryService is unavailable (e.g., very early bootstrap errors).
 *
 * Uses `Injector` to lazily resolve `GlobalErrorHandler` so Angular's full DI
 * tree (ToastService, Router, SectionErrorBus, SentryService) is available when
 * `handleError` is first called — not during construction.
 */
class CompositeErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);
  private readonly sentryHandler = Sentry.createErrorHandler({
    showDialog: false,
    logErrors: false,
  });

  /** Lazy-resolved so we don't instantiate GlobalErrorHandler before DI is ready. */
  private get appHandler(): GlobalErrorHandler {
    return this.injector.get(GlobalErrorHandler);
  }

  handleError(error: unknown): void {
    try {
      this.appHandler.handleError(error);
    } finally {
      try {
        this.sentryHandler.handleError(error);
      } catch {
        // Never let Sentry forwarding crash the host.
      }
    }
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // PreloadAllModules: kick off every lazy chunk in the background once the
    // shell has painted. Eliminates the white-flash that read as "the dashboard
    // reloads when I click a side-nav tab" — each tab's chunk is already in
    // memory by the time it's clicked. Pair with withViewTransitions so the
    // remaining swap is a quick cross-fade, not a network-bound mount.
    provideRouter(
      routes,
      withPreloading(PreloadAllModules),
      withViewTransitions({ skipInitialTransition: true }),
    ),
    provideHttpClient(
      withFetch(),
      withInterceptors([retryInterceptor, sentryBreadcrumbInterceptor, loadingInterceptor]),
    ),
    provideAnimations(),
    /**
     * PrimeNG v20 — themed to the cockpit (NOT default Aura blue).
     *
     * `CockpitPreset` overrides Aura's primary→blue with the cockpit cyan ramp
     * and maps PrimeNG dark surfaces onto the near-black cockpit canvas
     * (#03070a…#060610). See `src/app/theme/cockpit-preset.ts`.
     *
     * `darkModeSelector: '[data-cockpit="v2"]'` ties PrimeNG's dark color
     * scheme to the cockpit host attribute set on `<app-admin>`. PrimeNG then
     * applies the dark (cockpit) tokens to every component rendered inside the
     * admin subtree, while leaving the marketing surface unaffected.
     *
     * `cssLayer` nests PrimeNG styles into an explicit `@layer` so cockpit
     * SCSS (`_cockpit.scss`, `_polish.scss`) can still win specificity ties —
     * order: theme (PrimeNG) < cockpit overrides.
     */
    providePrimeNG({
      theme: {
        preset: CockpitPreset,
        options: {
          darkModeSelector: '[data-cockpit="v2"]',
          cssLayer: {
            name: 'primeng',
            order: 'theme, base, primeng',
          },
        },
      },
      ripple: true,
    }),
    // CompositeErrorHandler fans out to both GlobalErrorHandler (toast +
    // structured logs + section-error-bus) AND Sentry.createErrorHandler() so
    // every unhandled exception reaches Sentry even when the DI-injected
    // SentryService is unavailable (e.g., very early bootstrap errors).
    // GlobalErrorHandler is also registered directly so CompositeErrorHandler's
    // lazy injector.get() can resolve it with the full DI tree intact.
    GlobalErrorHandler,
    { provide: ErrorHandler, useClass: CompositeErrorHandler },
    // Sentry TraceService — auto-instruments router navigations as transactions.
    {
      provide: Sentry.TraceService,
      deps: [Router],
    },
    {
      provide: APP_INITIALIZER,
      useFactory: () => () => {
        // Touch the trace service so DI instantiates it. Side-effect: it
        // subscribes to the Router and produces nav transactions for free.
        inject(Sentry.TraceService);
        // Construct the SentryService once at boot so subsequent injectors
        // share the singleton + so the `enabled` flag is read at the
        // earliest possible point.
        inject(SentryService);
      },
      multi: true,
    },
    importProvidersFrom(
      TranslateModule.forRoot({
        fallbackLang: 'en',
      })
    ),
    provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),
    {
      provide: APP_INITIALIZER,
      useFactory: initTranslations,
      deps: [TranslateService],
      multi: true,
    },
    /**
     * Service worker — turns the admin into a real PWA.
     *
     * - `enabled: !isDevMode()` so the SW only registers in production.
     * - `registrationStrategy: 'registerWhenStable:30000'` waits for app
     *   stability (or 30s) before installing so the first paint is never
     *   blocked.
     * - The SW caches the shell + critical assets per `ngsw-config.json`.
     *   API responses live in `dataGroups` with a `freshness` strategy and a
     *   short timeout so the dashboard never reads stale data — falls back
     *   to cache only when the network is genuinely unreachable.
     */
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};

// Re-export CompositeErrorHandler for tests/inspection.
// CompositeErrorHandler is the active provider — it delegates to
// GlobalErrorHandler (toast + logs + section-error-bus) AND to
// Sentry.createErrorHandler() for belt-and-suspenders capture.
export { CompositeErrorHandler };
