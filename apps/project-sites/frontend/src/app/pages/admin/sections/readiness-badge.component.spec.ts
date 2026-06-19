import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReadinessBadgeComponent } from './readiness-badge.component';
import { ReadinessCacheService, type ReadinessData } from '../../../services/readiness-cache.service';

/** Controllable IntersectionObserver double — see readiness-cache for the batching. */
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
  const request = jasmine.createSpy('request');
  // One shared grade signal the stub hands back for any id (tests use a single id).
  const gradeSignal = signal<ReadinessData | null>(null);
  const cacheStub = { request, read: (_id: string) => gradeSignal };
  const realIO = window.IntersectionObserver;

  function make(siteId: string | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ReadinessBadgeComponent],
      providers: [{ provide: ReadinessCacheService, useValue: cacheStub }],
    });
    const f = TestBed.createComponent(ReadinessBadgeComponent);
    f.componentRef.setInput('siteId', siteId);
    f.detectChanges();
    return f;
  }

  beforeEach(() => {
    ioShouldFire = true;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;
    request.calls.reset();
    gradeSignal.set(null);
  });

  afterEach(() => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = realIO;
  });

  it('renders nothing + registers nothing when no siteId is provided', () => {
    const f = make(null);
    expect(request).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('[data-testid="readiness-badge"]')).toBeFalsy();
  });

  it('registers the id once in view + renders the grade from the cache', () => {
    gradeSignal.set({ grade: 'A', score: 96, passing: true, summary: 'Ready to publish.' });
    const f = make('site-1');
    expect(request).toHaveBeenCalledWith('site-1');
    const badge = f.nativeElement.querySelector('[data-testid="readiness-badge"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('Readiness A');
    expect(badge.textContent).toContain('96/100');
  });

  it('renders nothing when the cache has no grade for the site', () => {
    gradeSignal.set(null);
    const f = make('site-1');
    expect(f.nativeElement.querySelector('[data-testid="readiness-badge"]')).toBeFalsy();
  });

  it('does NOT register until the badge scrolls into view (lazy)', () => {
    ioShouldFire = false; // off-screen list row
    const f = make('site-1');
    expect(request).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('[data-testid="readiness-badge"]')).toBeFalsy();
  });
});
