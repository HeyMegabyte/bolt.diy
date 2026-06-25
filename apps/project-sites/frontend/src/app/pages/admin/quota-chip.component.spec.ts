import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { QuotaChipComponent } from './quota-chip.component';
import { ApiService } from '../../services/api.service';

function setup(quota: unknown, error = false) {
  const api = {
    get: jasmine
      .createSpy('get')
      .and.returnValue(error ? throwError(() => new Error('boom')) : of({ data: quota })),
  };
  TestBed.configureTestingModule({
    imports: [QuotaChipComponent],
    providers: [{ provide: ApiService, useValue: api }],
  });
  const fixture = TestBed.createComponent(QuotaChipComponent);
  fixture.detectChanges();
  return { fixture, api };
}

describe('QuotaChipComponent (#35 owner quota chip)', () => {
  it('calls GET /billing/quota and renders "used / limit" for a limited org', () => {
    const { fixture, api } = setup({
      used: 1,
      limit: 1,
      remaining: 0,
      allowed: false,
      plan: 'free',
      unlimited: false,
    });
    expect(api.get).toHaveBeenCalledWith('/billing/quota');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('1 / 1');
    expect(el.querySelector('.quota-chip.at-limit')).toBeTruthy(); // over quota → red state
  });

  it('renders nothing for an unlimited org', () => {
    const { fixture } = setup({
      used: 0,
      limit: null,
      remaining: null,
      allowed: true,
      plan: 'enterprise',
      unlimited: true,
    });
    expect((fixture.nativeElement as HTMLElement).querySelector('.quota-chip')).toBeNull();
  });

  it('stays silent (renders nothing) when the request fails', () => {
    const { fixture } = setup(null, true);
    expect((fixture.nativeElement as HTMLElement).querySelector('.quota-chip')).toBeNull();
  });
});
