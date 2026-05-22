/**
 * AppShellService — global imperative hooks for the document shell.
 *
 * @remarks
 * Owns the small set of imperative document-level mutations that don't fit
 * cleanly inside any single component: setting `<html lang>` when the active
 * translation changes, persisting the user's language choice, etc.
 *
 * Lives outside any component tree so `AppComponent` and admin shell can
 * subscribe to translation changes without coupling.
 *
 * @example
 * ```ts
 * const shell = inject(AppShellService);
 * shell.applyLanguage('es');
 * ```
 */
import { Injectable } from '@angular/core';

/** Supported language codes for the SPA. Mirrors `assets/i18n/*.json`. */
export type AppLanguage = 'en' | 'es';

/** localStorage key used to persist the active language. Read by `app.config.ts`. */
export const LANG_STORAGE_KEY = 'ps_language';

@Injectable({ providedIn: 'root' })
export class AppShellService {
  /**
   * Stamp the given language onto `<html lang>` and persist it. The browser
   * (and screen readers) need `<html lang>` to match the visible content for
   * WCAG 3.1.1 Language of Page. Persisted so `app.config.ts initTranslations`
   * picks it up on next boot.
   *
   * @param lang - language code to apply ('en' | 'es').
   */
  applyLanguage(lang: AppLanguage): void {
    try {
      document.documentElement.setAttribute('lang', lang);
    } catch {
      /* SSR or stripped-DOM environment — ignore */
    }
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* private mode / quota — ignore */
    }
  }
}
