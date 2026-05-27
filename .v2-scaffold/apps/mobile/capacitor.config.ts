/**
 * Capacitor 6 configuration for the `projectsites-mobile` shell.
 *
 * `appId` follows Brian's reverse-DNS namespace `space.megabyte.projectsites`
 * (matches `~/.claude` § Brand). Build output is the same Angular browser
 * bundle as `apps/web` so we ship one dashboard, one codebase, three runtimes
 * (web SSR, iOS, Android).
 *
 * Plugins (Camera, Geolocation, PushNotifications, Haptics, SplashScreen)
 * are configured below; `@org/util-platform` wraps them behind capability
 * checks so the web preview gracefully degrades.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'space.megabyte.projectsites',
  appName: 'ProjectSites',
  webDir: '../../dist/apps/mobile/browser',
  bundledWebRuntime: false,
  loggingBehavior: 'production',

  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false,
  },

  ios: {
    contentInset: 'always',
    scrollEnabled: true,
    backgroundColor: '#060610',
    limitsNavigationsToAppBoundDomains: true,
    preferredContentMode: 'mobile',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#060610',
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#060610',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Haptics: {},
    Camera: {
      iosImagePickerPresentationStyle: 'fullscreen',
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#060610',
      overlaysWebView: true,
    },
  },
};

export default config;
