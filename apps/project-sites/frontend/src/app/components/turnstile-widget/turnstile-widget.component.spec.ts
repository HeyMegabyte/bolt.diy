import { TestBed } from '@angular/core/testing';
import { TurnstileWidgetComponent } from './turnstile-widget.component';

describe('TurnstileWidgetComponent (#32)', () => {
  afterEach(() => {
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  it('renders NOTHING and emits no token when siteKey is empty (inert/dark)', async () => {
    TestBed.configureTestingModule({ imports: [TurnstileWidgetComponent] });
    const f = TestBed.createComponent(TurnstileWidgetComponent);
    const emitted: string[] = [];
    f.componentInstance.verified.subscribe((t) => emitted.push(t));
    f.detectChanges(); // triggers ngAfterViewInit (early-returns: no siteKey)
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="turnstile-widget"]')).toBeNull();
    expect(emitted).toEqual([]);
  });

  it('renders the host + emits the verified token when a siteKey is set', async () => {
    // Stub the global turnstile API: render() immediately invokes the callback.
    (window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, opts: { callback: (t: string) => void }) => {
        opts.callback('tok-123');
        return 'wid-1';
      },
      remove: () => {},
    };
    TestBed.configureTestingModule({ imports: [TurnstileWidgetComponent] });
    const f = TestBed.createComponent(TurnstileWidgetComponent);
    f.componentInstance.siteKey = '0xSITEKEY';
    // Script already "loaded" (window.turnstile present) → load() resolves immediately.
    const emitted: string[] = [];
    f.componentInstance.verified.subscribe((t) => emitted.push(t));
    f.detectChanges(); // triggers ngAfterViewInit → load() resolves → render() → callback
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="turnstile-widget"]')).toBeTruthy();
    expect(emitted).toEqual(['tok-123']);
  });
});
