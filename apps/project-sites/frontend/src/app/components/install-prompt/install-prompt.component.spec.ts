import { TestBed } from '@angular/core/testing';
import { InstallPromptComponent } from './install-prompt.component';

const DISMISS_KEY = 'ps_pwa_install_dismissed';

/** Build a synthetic beforeinstallprompt event with a controllable userChoice. */
function makeBipEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const e = new Event('beforeinstallprompt') as Event & {
    prompt: jasmine.Spy;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  e.prompt = jasmine.createSpy('prompt').and.resolveTo(undefined);
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe('InstallPromptComponent', () => {
  function make() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [InstallPromptComponent] });
    const f = TestBed.createComponent(InstallPromptComponent);
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    try { localStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
  });

  it('renders nothing until the browser fires beforeinstallprompt', () => {
    const f = make();
    expect(f.nativeElement.querySelector('[data-testid="install-prompt"]')).toBeFalsy();
  });

  it('shows the branded chip when installable + suppresses the default mini-bar', () => {
    const f = make();
    const evt = makeBipEvent();
    const prevented = spyOn(evt, 'preventDefault').and.callThrough();
    window.dispatchEvent(evt);
    f.detectChanges();
    expect(prevented).toHaveBeenCalled();
    expect(f.nativeElement.querySelector('[data-testid="install-prompt"]')).toBeTruthy();
  });

  it('calls the native prompt() and hides the chip on Install', async () => {
    const f = make();
    const evt = makeBipEvent('accepted');
    window.dispatchEvent(evt);
    f.detectChanges();
    f.nativeElement.querySelector('[data-testid="install-accept"]').click();
    await evt.userChoice;
    f.detectChanges();
    expect(evt.prompt).toHaveBeenCalled();
    expect(f.nativeElement.querySelector('[data-testid="install-prompt"]')).toBeFalsy();
  });

  it('remembers a dismissal so it never nags again', () => {
    const f = make();
    window.dispatchEvent(makeBipEvent());
    f.detectChanges();
    f.nativeElement.querySelector('[data-testid="install-dismiss"]').click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="install-prompt"]')).toBeFalsy();
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
  });

  it('stays hidden on a fresh mount when previously dismissed', () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    const f = make();
    window.dispatchEvent(makeBipEvent());
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="install-prompt"]')).toBeFalsy();
  });

  it('hides + remembers once the app is installed', () => {
    const f = make();
    window.dispatchEvent(makeBipEvent());
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="install-prompt"]')).toBeTruthy();
    window.dispatchEvent(new Event('appinstalled'));
    f.detectChanges();
    expect(f.nativeElement.querySelector('[data-testid="install-prompt"]')).toBeFalsy();
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
  });
});
