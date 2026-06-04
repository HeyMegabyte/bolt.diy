import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ToastComponent } from './toast.component';
import { ToastService } from '../../services/toast.service';

/**
 * The action-armed toast is the admin's destructive-action CONFIRM primitive
 * ("Delete this? [Delete]" — snapshots-revert / social / calendar all use it).
 * A confirmation that auto-dismisses must be announced ASSERTIVELY (role=alert)
 * so a screen-reader user is interrupted with the decision — a polite role=status
 * confirm can be missed entirely before it dismisses. Plain (non-actionable)
 * info/success toasts stay polite (role=status); errors stay role=alert.
 */
describe('ToastComponent (actionable-toast a11y announcement)', () => {
  let fixture: ComponentFixture<ToastComponent>;
  let toast: ToastService;
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const item = (): HTMLElement | null => host().querySelector('[data-testid="toast-item"]');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ToastComponent],
      providers: [provideNoopAnimations(), ToastService],
    });
    fixture = TestBed.createComponent(ToastComponent);
    toast = TestBed.inject(ToastService);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('announces an action-armed warning (a confirm) ASSERTIVELY via role=alert', () => {
    toast.warning('Delete this post? This can’t be undone.', { action: { label: 'Delete', run: () => undefined } });
    fixture.detectChanges();
    expect(item()?.getAttribute('role')).toBe('alert');
    expect(item()?.querySelector('.toast-action')?.textContent?.trim()).toBe('Delete');
  });

  it('keeps a plain info toast polite (role=status) — no action, no interruption', () => {
    toast.show('Saved', 'info');
    fixture.detectChanges();
    expect(item()?.getAttribute('role')).toBe('status');
  });

  it('keeps a non-actionable warning polite (role=status)', () => {
    toast.warning('Heads up — running low on credits.');
    fixture.detectChanges();
    expect(item()?.getAttribute('role')).toBe('status');
  });

  it('keeps errors assertive (role=alert) regardless of action', () => {
    toast.error('Request failed');
    fixture.detectChanges();
    expect(item()?.getAttribute('role')).toBe('alert');
  });

  it('the container is NOT itself a live region — per-toast role is authoritative (no polite wrapper masking assertive errors)', () => {
    toast.error('boom');
    fixture.detectChanges();
    const container = (fixture.nativeElement as HTMLElement).querySelector('.toast-container');
    expect(container).withContext('container renders').toBeTruthy();
    expect(container?.getAttribute('aria-live'))
      .withContext('no redundant polite container that double-announces + downgrades errors')
      .toBeNull();
    expect(item()?.getAttribute('role')).withContext('error stays assertive via its own region').toBe('alert');
  });
});
