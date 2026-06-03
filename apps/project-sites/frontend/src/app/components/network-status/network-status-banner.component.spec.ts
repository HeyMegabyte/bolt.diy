import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NetworkStatusBannerComponent } from './network-status-banner.component';

/**
 * Offline-awareness contract for the network status banner (LIVE in the app
 * shell, previously untested). The user MUST be told when they go offline (so
 * they know changes will retry) and reassured on reconnect. Locks: mount state
 * reflects navigator.onLine; an `offline` event flips to offline + shows the
 * banner; an `online` event flips back + shows the "back online" state;
 * dismiss() hides it. navigator.onLine is overridden + window events dispatched.
 */
describe('NetworkStatusBannerComponent (offline awareness)', () => {
  let onlineVal = true;
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => onlineVal });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'onLine');
    if (original && !Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')) {
      Object.defineProperty(Navigator.prototype, 'onLine', original);
    }
    TestBed.resetTestingModule();
  });

  function render(initialOnline: boolean): ComponentFixture<NetworkStatusBannerComponent> {
    onlineVal = initialOnline;
    TestBed.configureTestingModule({ imports: [NetworkStatusBannerComponent] });
    const fx = TestBed.createComponent(NetworkStatusBannerComponent);
    fx.detectChanges(); // ngOnInit binds the online/offline listeners
    return fx;
  }

  it('mounting while OFFLINE shows the banner in the offline state', () => {
    const c = render(false).componentInstance;
    expect(c.online()).toBeFalse();
    expect(c.visible()).withContext('offline at mount → banner visible').toBeTrue();
  });

  it('mounting while ONLINE keeps the banner hidden', () => {
    const c = render(true).componentInstance;
    expect(c.online()).toBeTrue();
    expect(c.visible()).withContext('no banner when already online').toBeFalse();
  });

  it('an offline event flips to offline + shows the banner', () => {
    const c = render(true).componentInstance;
    onlineVal = false;
    window.dispatchEvent(new Event('offline'));
    expect(c.online()).toBeFalse();
    expect(c.visible()).toBeTrue();
  });

  it('an online event flips back to online + surfaces the reconnect banner', () => {
    const c = render(false).componentInstance;
    onlineVal = true;
    window.dispatchEvent(new Event('online'));
    expect(c.online()).toBeTrue();
    expect(c.visible()).withContext('"back online" state shown before auto-hide').toBeTrue();
  });

  it('dismiss() hides the banner', () => {
    const c = render(false).componentInstance;
    expect(c.visible()).toBeTrue();
    c.dismiss();
    expect(c.visible()).toBeFalse();
  });
});
