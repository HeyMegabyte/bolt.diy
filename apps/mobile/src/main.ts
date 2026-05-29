import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { APP_ROUTES } from './app/app.routes';
import { initializeNativeBridges } from './app/native/native-bootstrap';

/**
 * Bootstrap the Angular shell, then wire native-only bridges (push, status bar,
 * splash, deep links) AFTER the SPA mounts so first paint is never blocked by
 * native I/O.
 */
bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(APP_ROUTES, withViewTransitions()),
    provideHttpClient(withFetch()),
  ],
})
  .then(() => initializeNativeBridges())
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[ps-mobile] bootstrap failed', err);
  });
