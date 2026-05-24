import { type ApplicationConfig, APP_INITIALIZER, ErrorHandler, importProvidersFrom, inject, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, Router, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideServiceWorker } from '@angular/service-worker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import * as Sentry from '@sentry/angular';
import { routes } from './app.routes';
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
 * structured logs + section-error-bus) AND to `Sentry.errorHandler()` so events
 * are captured for offline analysis. Both paths run for every error — neither
 * is allowed to swallow the other.
 */
class CompositeErrorHandler implements ErrorHandler {
  private readonly app = new GlobalErrorHandler();
  private readonly sentryHandler = Sentry.createErrorHandler({
    showDialog: false,
    logErrors: false,
  });

  handleError(error: unknown): void {
    try {
      this.app.handleError(error);
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
    provideRouter(routes, withViewTransitions({ skipInitialTransition: true })),
    provideHttpClient(
      withFetch(),
      withInterceptors([retryInterceptor, sentryBreadcrumbInterceptor, loadingInterceptor]),
    ),
    provideAnimations(),
    // Single ErrorHandler that fans out to both the in-app toast surface AND
    // Sentry. Plain GlobalErrorHandler also self-reports to Sentry via
    // SentryService for cases where it's instantiated directly (tests).
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
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

// Re-export CompositeErrorHandler for tests/inspection. The active provider
// above uses GlobalErrorHandler (which itself reports to Sentry via injection)
// so the composite handler is available as an alternative provider strategy
// if a future config wants explicit dual-dispatch.
export { CompositeErrorHandler };
