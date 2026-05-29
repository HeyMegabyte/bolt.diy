import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 6 config for the ProjectSites mobile shell.
 *
 * Strategy: load the deployed Angular admin SPA directly so the mobile app
 * stays in sync with web releases without rebuilding native binaries for
 * every UI change. Native plugins (push, camera, share) bridge to the
 * webview via @capacitor/* runtime.
 *
 * See README.md § "Why server-served URL" for tradeoffs.
 */
const config: CapacitorConfig = {
  appId: 'dev.projectsites.mobile',
  appName: 'ProjectSites',
  webDir: 'dist',
  // Production: point the webview at the deployed admin SPA.
  // Override with CAPACITOR_SERVER_URL env var for staging / local dev.
  server: {
    url: process.env.CAPACITOR_SERVER_URL ?? 'https://projectsites.dev/admin',
    cleartext: false,
    allowNavigation: [
      'projectsites.dev',
      '*.projectsites.dev',
      'editor.projectsites.dev',
    ],
  },
  ios: {
    contentInset: 'always',
    scheme: 'projectsites',
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#060610',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#060610',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Camera: {
      // Asks the user once; subsequent uploads reuse the granted permission.
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
