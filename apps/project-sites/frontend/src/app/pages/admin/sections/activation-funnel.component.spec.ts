import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AdminActivationFunnelComponent } from './activation-funnel.component';
import {
  ActivationAnalyticsService,
  type ActivationFunnelResponse,
} from '../../../services/activation-analytics.service';

function resp(over: Partial<ActivationFunnelResponse> = {}): ActivationFunnelResponse {
  return {
    stages: [],
    conversion: {
      steps: [
        { stage: 'lead.discovered', label: 'Discovered', ordinal: 0, sites: 100, fromPrevPct: null, fromTopPct: 100 },
        { stage: 'subscription.active', label: 'Converted', ordinal: 3, sites: 12, fromPrevPct: 40, fromTopPct: 12 },
      ],
      topSites: 100,
      bottomSites: 12,
      overallPct: 12,
    },
    degraded: false,
    count: 4,
    ...over,
  };
}

function setup(value = of(resp())) {
  const getActivationFunnel = jasmine.createSpy('getActivationFunnel').and.returnValue(value);
  TestBed.configureTestingModule({
    imports: [AdminActivationFunnelComponent],
    providers: [{ provide: ActivationAnalyticsService, useValue: { getActivationFunnel } }],
  });
  const fixture: ComponentFixture<AdminActivationFunnelComponent> =
    TestBed.createComponent(AdminActivationFunnelComponent);
  fixture.detectChanges(); // ngOnInit → load
  return { fixture, getActivationFunnel };
}

function text(fixture: ComponentFixture<unknown>, sel: string): string | null {
  return fixture.nativeElement.querySelector(sel)?.textContent?.trim() ?? null;
}

describe('AdminActivationFunnelComponent', () => {
  it('loads the funnel on init and renders the overall conversion', () => {
    const { fixture, getActivationFunnel } = setup();
    expect(getActivationFunnel).toHaveBeenCalledWith({ days: 30 });
    expect(text(fixture, '[data-testid="funnel-overall"]')).toContain('12% overall');
  });

  it('renders a bar per conversion step with the prev-rate label', () => {
    const { fixture } = setup();
    const bars = fixture.nativeElement.querySelectorAll('[data-testid="funnel-bars"] > div');
    expect(bars.length).toBe(2);
    const html = fixture.nativeElement.querySelector('[data-testid="funnel-bars"]').textContent;
    expect(html).toContain('Discovered');
    expect(html).toContain('Converted');
    expect(html).toContain('40% of prev'); // the converted step's drop-off
  });

  it('shows the provisioning note when degraded', () => {
    const { fixture } = setup(of(resp({ degraded: true })));
    expect(fixture.nativeElement.querySelector('[data-testid="funnel-degraded"]')).not.toBeNull();
  });

  it('does NOT show the provisioning note when not degraded', () => {
    const { fixture } = setup();
    expect(fixture.nativeElement.querySelector('[data-testid="funnel-degraded"]')).toBeNull();
  });

  it('renders an error card with Retry on load failure', () => {
    const { fixture } = setup(throwError(() => new Error('boom')));
    expect(fixture.nativeElement.querySelector('[data-testid="funnel-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="funnel-bars"]')).toBeNull();
  });
});
