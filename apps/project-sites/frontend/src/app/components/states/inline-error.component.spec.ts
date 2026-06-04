import { TestBed } from '@angular/core/testing';
import { InlineErrorComponent } from './inline-error.component';

/**
 * Guards the compact inline-error primitive: renders the message in a
 * role=alert chip, emits (retry) from the button, hides the button when
 * showRetry is false, and toggles the red 'error' tone class.
 */
function make(inputs: Partial<{ message: string; retryLabel: string; showRetry: boolean; tone: 'warn' | 'error' }>) {
  const f = TestBed.createComponent(InlineErrorComponent);
  f.componentRef.setInput('message', inputs.message ?? 'Something failed');
  if (inputs.retryLabel !== undefined) f.componentRef.setInput('retryLabel', inputs.retryLabel);
  if (inputs.showRetry !== undefined) f.componentRef.setInput('showRetry', inputs.showRetry);
  if (inputs.tone !== undefined) f.componentRef.setInput('tone', inputs.tone);
  f.detectChanges();
  return f;
}

describe('InlineErrorComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the message in a role=alert region', () => {
    const f = make({ message: 'Badges may be out of date.' });
    const alert = f.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).withContext('role=alert present for AT').not.toBeNull();
    expect(alert.textContent).toContain('Badges may be out of date.');
  });

  it('emits (retry) when the Retry button is clicked', () => {
    const f = make({ message: 'x', retryLabel: 'Reload' });
    let fired = 0;
    f.componentInstance.retry.subscribe(() => fired++);
    const btn = f.nativeElement.querySelector('[data-testid="inline-error-retry"]') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('Reload');
    btn.click();
    expect(fired).toBe(1);
  });

  it('hides the Retry button when showRetry is false', () => {
    const f = make({ message: 'x', showRetry: false });
    expect(f.nativeElement.querySelector('[data-testid="inline-error-retry"]')).toBeNull();
  });

  it('applies the red error tone class only for tone="error"', () => {
    expect((make({ message: 'x' }).nativeElement.querySelector('.ie') as HTMLElement).classList.contains('ie--error')).toBeFalse();
    expect((make({ message: 'x', tone: 'error' }).nativeElement.querySelector('.ie') as HTMLElement).classList.contains('ie--error')).toBeTrue();
  });
});
