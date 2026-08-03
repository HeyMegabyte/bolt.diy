import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { UpgradeMomentsComponent } from './upgrade-moments.component';
import { ApiService } from '../../../services/api.service';
import { FeatureFlagService } from '../../../services/feature-flag.service';

const MOMENT = {
  trigger: 'custom_domain',
  eligible: true,
  headline: 'Launch on your own domain',
  body: 'A custom domain lifts first-visit trust.',
  benefits: ['Connect yourbusiness.com', 'Automatic HTTPS'],
  cta_label: 'Add domain',
  cta_url: '/admin/billing?upsell=custom_domain',
  price_hint: 'Paid plan',
  value_metric: 'Custom-domain sites earn first-visit trust faster.',
  dismiss_key: 'upgrade_moment:custom_domain',
};

function make(opts: { get?: jasmine.Spy; post?: jasmine.Spy; flagOn?: boolean } = {}) {
  const get = opts.get ?? jasmine.createSpy('get').and.returnValue(of({ moments: [MOMENT], count: 1 }));
  const post = opts.post ?? jasmine.createSpy('post').and.returnValue(of({ trigger: 'custom_domain', dismissed: true }));
  const flagOn = opts.flagOn ?? true;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [UpgradeMomentsComponent],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: { get, post } },
      // The component gates its fetch on the flag (isOn → 200 resolution) so it
      // never calls the 404ing feature endpoint while dark. Mock it on.
      { provide: FeatureFlagService, useValue: { isOn: () => of(flagOn) } },
    ],
  });
  const f = TestBed.createComponent(UpgradeMomentsComponent);
  f.detectChanges();
  return { f, get, post };
}

describe('UpgradeMomentsComponent', () => {
  it('fetches eligible moments and renders a trigger-attributed CTA', () => {
    const { f, get } = make();
    expect(get).toHaveBeenCalledWith('/upgrade-moments', undefined, { silent: true });
    expect(f.nativeElement.querySelector('[data-testid="upgrade-moments"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[data-testid="upgrade-moment-card"]')).toBeTruthy();
    const cta = f.nativeElement.querySelector('[data-testid="upgrade-moment-cta"]');
    expect(cta.getAttribute('href')).toContain('upsell=custom_domain');
    expect(cta.getAttribute('data-bcl-trigger')).toBe('custom_domain');
    expect(f.nativeElement.textContent).toContain('Launch on your own domain');
  });

  it('does NOT call the feature endpoint when the flag is off (no console 404)', () => {
    const { f, get } = make({ flagOn: false });
    expect(get).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('[data-testid="upgrade-moments"]')).toBeNull();
  });

  it('renders nothing when there are no eligible moments', () => {
    const { f } = make({ get: jasmine.createSpy('get').and.returnValue(of({ moments: [], count: 0 })) });
    expect(f.nativeElement.querySelector('[data-testid="upgrade-moments"]')).toBeNull();
  });

  it('renders nothing (silent) when the request fails / flag is off', () => {
    const { f } = make({ get: jasmine.createSpy('get').and.returnValue(throwError(() => new Error('404'))) });
    expect(f.componentInstance.moments().length).toBe(0);
    expect(f.nativeElement.querySelector('[data-testid="upgrade-moments"]')).toBeNull();
  });

  it('optimistically removes a card on dismiss and persists it', () => {
    const { f, post } = make();
    f.componentInstance.dismiss('custom_domain');
    expect(post).toHaveBeenCalledWith('/upgrade-moments/custom_domain/dismiss', {});
    expect(f.componentInstance.moments().length).toBe(0);
  });

  it('restores the card if the dismiss request fails', () => {
    const { f } = make({ post: jasmine.createSpy('post').and.returnValue(throwError(() => new Error('boom'))) });
    f.componentInstance.dismiss('custom_domain');
    expect(f.componentInstance.moments().length).toBe(1);
  });
});
