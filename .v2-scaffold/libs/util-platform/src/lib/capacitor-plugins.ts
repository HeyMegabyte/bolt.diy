/**
 * Lazy loaders for the optional Capacitor plugins.
 *
 * @remarks
 * Each function dynamic-imports the plugin module by *string literal* — that
 * stays opaque to the TypeScript checker, so the workspace compiles even
 * when the optional `@capacitor/*` packages aren't installed (e.g., when
 * building `apps/web` without the mobile shell). At runtime, the lazy
 * import only fires on a native device (`PlatformService.isNative === true`),
 * so the missing-module path is unreachable in production.
 *
 * Ambient types below describe the shapes we consume — kept narrow on
 * purpose. If the real `@capacitor/*` packages are installed, their types
 * are a superset of ours and compile-time compatibility holds.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ---------- Camera --------------------------------------------------- */

export interface CameraPhoto {
  readonly dataUrl?: string;
  readonly format?: string;
}
export interface CameraGetPhotoOptions {
  readonly quality?: number;
  readonly allowEditing?: boolean;
  readonly resultType?: unknown;
  readonly source?: unknown;
  readonly webUseInput?: boolean;
}
export interface CameraModule {
  readonly Camera: { getPhoto(opts: CameraGetPhotoOptions): Promise<CameraPhoto> };
  readonly CameraResultType: { readonly DataUrl: unknown };
  readonly CameraSource: { readonly Prompt: unknown };
}

export async function loadCamera(): Promise<CameraModule> {
  const mod = (await import(/* @vite-ignore */ '@capacitor/camera' as string)) as unknown;
  return mod as CameraModule;
}

/* ---------- Geolocation --------------------------------------------- */

export interface GeolocationPosition {
  readonly coords: {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracy: number;
    readonly altitude: number | null;
    readonly heading: number | null;
    readonly speed: number | null;
  };
  readonly timestamp: number;
}
export interface GeolocationModule {
  readonly Geolocation: {
    getCurrentPosition(opts: {
      enableHighAccuracy?: boolean;
      timeout?: number;
    }): Promise<GeolocationPosition>;
  };
}

export async function loadGeolocation(): Promise<GeolocationModule> {
  const mod = (await import(/* @vite-ignore */ '@capacitor/geolocation' as string)) as unknown;
  return mod as GeolocationModule;
}

/* ---------- Push notifications -------------------------------------- */

export interface PushPermStatus {
  readonly receive: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';
}
export interface PushNotificationsModule {
  readonly PushNotifications: {
    requestPermissions(): Promise<PushPermStatus>;
    register(): Promise<void>;
  };
}

export async function loadPushNotifications(): Promise<PushNotificationsModule> {
  const mod = (await import(/* @vite-ignore */ '@capacitor/push-notifications' as string)) as unknown;
  return mod as PushNotificationsModule;
}

/* ---------- Haptics -------------------------------------------------- */

export interface HapticsModule {
  readonly Haptics: {
    impact(opts: { style: unknown }): Promise<void>;
    notification(opts: { type: unknown }): Promise<void>;
    selectionStart(): Promise<void>;
  };
  readonly ImpactStyle: {
    readonly Light: unknown;
    readonly Medium: unknown;
    readonly Heavy: unknown;
  };
  readonly NotificationType: {
    readonly Success: unknown;
    readonly Warning: unknown;
    readonly Error: unknown;
  };
}

export async function loadHaptics(): Promise<HapticsModule> {
  const mod = (await import(/* @vite-ignore */ '@capacitor/haptics' as string)) as unknown;
  return mod as HapticsModule;
}
