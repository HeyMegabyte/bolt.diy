/**
 * Capability-result types for `@org/util-platform`.
 *
 * Every native interaction lands here as a discriminated union — callers
 * never need to know whether the result came from Capacitor or a browser
 * fallback. `source: 'native' | 'web' | 'unsupported'` keeps the trail
 * legible in Sentry breadcrumbs + PostHog events.
 */

/** Photo capture result. */
export interface PhotoResult {
  readonly dataUrl: string;
  readonly format: 'jpeg' | 'png' | 'webp' | 'avif';
  readonly width?: number;
  readonly height?: number;
  readonly source: 'native' | 'web';
}

/** Geolocation result. */
export interface LocationResult {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
  readonly altitude: number | null;
  readonly heading: number | null;
  readonly speed: number | null;
  readonly timestamp: number;
  readonly source: 'native' | 'web';
}

/** Push permission result. */
export interface PushPermissionResult {
  readonly status: 'granted' | 'denied' | 'prompt' | 'unsupported';
  readonly token?: string;
  readonly source: 'native' | 'web' | 'unsupported';
}

/** Haptic feedback intensity. */
export type HapticImpact = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error';

/** Haptic feedback result. */
export interface HapticResult {
  readonly fired: boolean;
  readonly source: 'native' | 'web' | 'unsupported';
}
