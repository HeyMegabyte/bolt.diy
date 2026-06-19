import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReadinessBadgeComponent } from './readiness-badge.component';
import { ApiService } from '../../../services/api.service';

/**
 * Controllable IntersectionObserver double. `fire = true` invokes the callback
 * synchronously on observe() (simulating an in-viewport badge); `fire = false`
 * never fires (simulating an off-screen list row that hasn't scrolled in).
 */
let ioShouldFire = true;
class MockIntersectionObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {}
  observe(el: Element): void {
    if (ioShouldFire) {
      this.cb(
        [{ isIntersecting: true, target: el, intersectionRatio: 1 } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

describe('ReadinessBadgeComponent', () => {
  const get = jasmine.createSpy('get');
  const realIO = window.IntersectionObserver;

  function make(siteId: string | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ReadinessBadgeComponent],
      providers: [{ provide: ApiService, useValue: { get } }],
    });
    const f = TestBed.createComponent(ReadinessBadgeComponent);
    f.componentRef.setInput('siteId', siteId);
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    ioShouldFire = true;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;
    get.calls.reset();
    get.and.returnValue(of({ data: null }));
  });

  afterEach(() => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = realIO;
  });

  it('renders nothing when no siteId is provided', () => {
    const f = make(null);
    expect(get).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('[data-testid="readiness-badge"]')).toBeFalsy();
  });

  it('fetches by id and renders the A grade badge + score once in view', () => {
    get.and.returnValue(of({ data: { grade: 'A', score: 96, passing: true, summary: 'Ready to publish.' } }));
    const f = make('site-1');
    expect(get).toHaveBeenCalledWith('/sites/site-1/readiness', undefined, { silent: true });
    const badge = f.nativeElement.querySelector('[data-testid="readiness-badge"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('Readiness A');
    expect(badge.textContent).toContain('96/100');
  });

  it('renders nothing when the site has no scored build (data null)', () => {
    get.and.returnValue(of({ data: null }));
    const f = make('site-1');
    expect(f.nativeElement.querySelector('[data-testid="readiness-badge"]')).toBeFalsy();
  });

  it('degrades to nothing on a request error', () => {
    get.and.returnValue(throwError(() => new Error('boom')));
    const f = make('site-1');
    expect(f.nativeElement.querySelector('[data-testid="readiness-badge"]')).toBeFalsy();
  });

  it('does NOT fetch until the badge scrolls into view (lazy)', () => {
    ioShouldFire = false; // off-screen list row
    const f = make('site-1');
    expect(get).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('[data-testid="readiness-badge"]')).toBeFalsy();
  });
});
