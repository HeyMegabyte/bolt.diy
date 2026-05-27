/**
 * `@org/util-platform` — Capacitor / native-API capability wrappers.
 *
 * Every export returns an `Observable<T>`. Native paths execute Capacitor
 * plugins; web paths fall back to standard browser APIs so the same code
 * runs in `apps/mobile` (iOS / Android via Capacitor) and `apps/web`
 * (SSR + browser).
 *
 * @see ./lib/platform.service
 */
export * from './lib/platform.service';
export * from './lib/platform.types';
