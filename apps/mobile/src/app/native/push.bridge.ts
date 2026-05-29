import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications';

/**
 * Push notifications bridge.
 *
 * Two event surfaces post the registered FCM/APNs token back to the
 * Worker so the user's account can subscribe to:
 *   - form submission events (`form.submission.received`)
 *   - donation success (`donation.completed`)
 *   - build pipeline status (`site.build.failed`, `site.build.published`)
 *
 * The Worker endpoint `POST /api/notifications/devices` accepts the token
 * + platform; see apps/project-sites/src/routes/api.ts for the binding.
 */
export async function registerPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') {
    console.warn('[ps-mobile] push permission denied');
    return;
  }

  await PushNotifications.register();

  PushNotifications.addListener('registration', (token: Token) => {
    void postDeviceToken(token.value);
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.warn('[ps-mobile] push registration error', err);
  });

  PushNotifications.addListener(
    'pushNotificationReceived',
    (notif: PushNotificationSchema) => {
      // Foreground notification — show inline toast or update badge.
      console.log('[ps-mobile] push received', notif.title, notif.body);
    },
  );

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    // User tapped a notification — route the webview if payload includes a URL.
    const url = action.notification.data?.['url'];
    if (typeof url === 'string') {
      window.location.assign(url);
    }
  });
}

async function postDeviceToken(token: string): Promise<void> {
  const platform = Capacitor.getPlatform();
  try {
    await fetch('https://projectsites.dev/api/notifications/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, platform }),
      credentials: 'include',
    });
  } catch (err) {
    console.warn('[ps-mobile] failed to register device', err);
  }
}
