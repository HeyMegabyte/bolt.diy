import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { registerPushNotifications } from './push.bridge';
import { wireDeepLinkHandler } from './deep-links.bridge';

/**
 * Wires every native bridge the mobile shell relies on. Safe to call on web
 * (every plugin guards with `Capacitor.isNativePlatform()` and no-ops there).
 */
export async function initializeNativeBridges(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await StatusBar.setStyle({ style: Style.Dark });
  } catch (err) {
    console.warn('[ps-mobile] StatusBar unavailable', err);
  }

  wireDeepLinkHandler();

  // Fire-and-forget — never block first paint on push token negotiation.
  void registerPushNotifications();

  // Splash screen hides itself after launchShowDuration (capacitor.config.ts),
  // but we force-hide on first interactive frame for snappier feel.
  await SplashScreen.hide().catch(() => undefined);

  // Listen for back-button on Android — pop the webview history first.
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });
}
