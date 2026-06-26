import {
  type ApplicationConfig,
  APP_INITIALIZER,
  ErrorHandler,
  Injector,
  importProvidersFrom,
  inject,
  isDevMode,
  provideZoneChangeDetection,
} from '@angular/core';
import {
  PreloadAllModules,
  provideRouter,
  withInMemoryScrolling,
  withPreloading,
  withViewTransitions,
} from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideServiceWorker } from '@angular/service-worker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { routes } from './app.routes';
import { firstValueFrom } from 'rxjs';
import { GlobalErrorHandler } from './services/error-handler.service';
import { retryInterceptor } from './interceptors/retry.interceptor';
import { loadingInterceptor } from './interceptors/loading.interceptor';

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
 * Thin ErrorHandler that forwards to the existing GlobalErrorHandler (toasts +
 * structured logs + section-error-bus). Errors also surface through PostHog +
 * Axiom via the structured logging path — Sentry was removed (see
 * docs/observability/sentry-removed.md).
 *
 * Uses `Injector` to lazily resolve `GlobalErrorHandler` so Angular's full DI
 * tree (ToastService, Router, SectionErrorBus) is available when `handleError`
 * is first called — not during construction.
 */
class CompositeErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);

  /** Lazy-resolved so we don't instantiate GlobalErrorHandler before DI is ready. */
  private get appHandler(): GlobalErrorHandler {
    return this.injector.get(GlobalErrorHandler);
  }

  handleError(error: unknown): void {
    this.appHandler.handleError(error);
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
      // Lets `routerLink="/" fragment="pricing"` (e.g. the /signin header nav)
      // scroll to the homepage #pricing section after navigation.
      withInMemoryScrolling({ anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(
      withFetch(),
      withInterceptors([retryInterceptor, loadingInterceptor]),
    ),
    provideAnimations(),
    // PrimeNG fully removed from the admin — every component migrated to Spartan
    // (hlmBtn/hlmBadge/hlmInput/hlmCheckbox), DialogShell, TanStack table, and the
    // cockpit ToastService. No providePrimeNG / CockpitPreset needed anymore.
    // CompositeErrorHandler delegates to GlobalErrorHandler (toast + structured
    // logs + section-error-bus). GlobalErrorHandler is registered directly so the
    // lazy injector.get() can resolve it with the full DI tree intact.
    GlobalErrorHandler,
    { provide: ErrorHandler, useClass: CompositeErrorHandler },
    importProvidersFrom(
      TranslateModule.forRoot({
        fallbackLang: 'en',
      }),
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

// Re-export CompositeErrorHandler for tests/inspection. It delegates to
// GlobalErrorHandler (toast + logs + section-error-bus); error reporting now
// flows through PostHog + Axiom structured logs, not Sentry.
export { CompositeErrorHandler };
