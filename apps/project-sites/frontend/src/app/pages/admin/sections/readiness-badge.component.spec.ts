import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReadinessBadgeComponent } from './readiness-badge.component';
import { ApiService } from '../../../services/api.service';

describe('ReadinessBadgeComponent', () => {
  const get = jasmine.createSpy('get');

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
    get.calls.reset();
    get.and.returnValue(of({ data: null }));
  });

  it('renders nothing when no siteId is provided', () => {
    const f = make(null);
    expect(get).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('[data-testid="readiness-badge"]')).toBeFalsy();
  });

  it('fetches by id and renders the A grade badge + score', () => {
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
});
