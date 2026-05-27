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

/* ---------- Stripe (Apple Pay / Google Pay) ------------------------- */

export interface StripeCreatePaymentSheetOpts {
  readonly paymentIntentClientSecret: string;
  readonly customerEphemeralKeySecret?: string;
  readonly customerId?: string;
  readonly merchantDisplayName: string;
  readonly style?: 'alwaysDark' | 'alwaysLight' | 'automatic';
  readonly enableApplePay?: boolean;
  readonly applePayMerchantId?: string;
  readonly enableGooglePay?: boolean;
  readonly googlePayIsTesting?: boolean;
  readonly countryCode?: string;
}

export interface StripePresentPaymentSheetResult {
  readonly paymentResult: 'paymentSheetCompleted' | 'paymentSheetCanceled' | 'paymentSheetFailed';
  readonly paymentIntent?: { readonly id?: string };
}

export interface StripeModule {
  readonly Stripe: {
    initialize(opts: { publishableKey: string }): Promise<void>;
    createPaymentSheet(opts: StripeCreatePaymentSheetOpts): Promise<void>;
    presentPaymentSheet(): Promise<StripePresentPaymentSheetResult>;
  };
}

export async function loadStripe(): Promise<StripeModule> {
  const mod = (await import(/* @vite-ignore */ '@capacitor-community/stripe' as string)) as unknown;
  return mod as StripeModule;
}

/* ---------- Biometric Auth ------------------------------------------ */

export interface BiometricAuthModule {
  readonly BiometricAuth: {
    checkBiometry(): Promise<{
      readonly isAvailable: boolean;
      readonly biometryType?: string;
      readonly reason?: string;
    }>;
    authenticate(opts: {
      readonly reason?: string;
      readonly cancelTitle?: string;
      readonly allowDeviceCredential?: boolean;
      readonly iosFallbackTitle?: string;
      readonly androidTitle?: string;
      readonly androidSubtitle?: string;
    }): Promise<void>;
  };
}

export async function loadBiometricAuth(): Promise<BiometricAuthModule> {
  const mod = (await import(
    /* @vite-ignore */ '@capacitor-community/biometric-auth' as string
  )) as unknown;
  return mod as BiometricAuthModule;
}

/* ---------- Live Activity (iOS) ------------------------------------- */

export interface LiveActivityModule {
  readonly LiveActivity: {
    startActivity(opts: { readonly activityId: string; readonly attributes: Record<string, unknown>; readonly initialState: Record<string, unknown> }): Promise<{ readonly activityId: string }>;
    updateActivity(opts: { readonly activityId: string; readonly state: Record<string, unknown> }): Promise<void>;
    endActivity(opts: { readonly activityId: string; readonly state?: Record<string, unknown> }): Promise<void>;
  };
}

export async function loadLiveActivity(): Promise<LiveActivityModule> {
  const mod = (await import(
    /* @vite-ignore */ '@capacitor-community/live-activity' as string
  )) as unknown;
  return mod as LiveActivityModule;
}
