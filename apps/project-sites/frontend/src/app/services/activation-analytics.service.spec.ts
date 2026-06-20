import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ActivationAnalyticsService } from './activation-analytics.service';
import { ApiService } from './api.service';

/**
 * The admin dashboard's typed data layer over the four Tinybird analytics
 * endpoints. Asserts each method hits the right path, drops undefined params +
 * stringifies the rest, and passes the response straight through (incl. the
 * `degraded` zero-state flag the panel branches on).
 */
function setup() {
  const get = jasmine.createSpy('get').and.returnValue(of({}));
  TestBed.configureTestingModule({
    providers: [ActivationAnalyticsService, { provide: ApiService, useValue: { get } }],
  });
  return { svc: TestBed.inject(ActivationAnalyticsService), get };
}

describe('ActivationAnalyticsService', () => {
  it('getActivationFunnel hits the funnel path with stringified, cleaned params', () => {
    const { svc, get } = setup();
    svc.getActivationFunnel({ tenant_id: 'org-1', days: 30, source: undefined }).subscribe();
    expect(get).toHaveBeenCalledWith('/admin/activation-funnel', { tenant_id: 'org-1', days: '30' });
  });

  it('passes the funnel response (incl. conversion + degraded) straight through', (done) => {
    const { svc, get } = setup();
    const resp = {
      stages: [{ stage: 'lead.discovered', label: 'Discovered', ordinal: 0, events: 5, sites: 4 }],
      conversion: { steps: [], topSites: 4, bottomSites: 1, overallPct: 25 },
      degraded: false,
      count: 1,
    };
    get.and.returnValue(of(resp));
    svc.getActivationFunnel().subscribe((r) => {
      expect(r).toEqual(resp);
      expect(r.degraded).toBe(false);
      done();
    });
  });

  it('getEventsDaily hits the events-daily path', () => {
    const { svc, get } = setup();
    svc.getEventsDaily({ event: 'site.published' }).subscribe();
    expect(get).toHaveBeenCalledWith('/admin/analytics/events-daily', { event: 'site.published' });
  });

  it('getPublishesBySource hits its path', () => {
    const { svc, get } = setup();
    svc.getPublishesBySource({ source: 'claim' }).subscribe();
    expect(get).toHaveBeenCalledWith('/admin/analytics/publishes-by-source', { source: 'claim' });
  });

  it('getClaimsBySource forwards source + campaign params', () => {
    const { svc, get } = setup();
    svc.getClaimsBySource({ tenant_id: 't1', source: 'twitter', campaign: 'spring' }).subscribe();
    expect(get).toHaveBeenCalledWith('/admin/analytics/claims-by-source', {
      tenant_id: 't1',
      source: 'twitter',
      campaign: 'spring',
    });
  });

  it('omits empty-string and undefined params entirely', () => {
    const { svc, get } = setup();
    svc.getClaimsBySource({ tenant_id: '', source: undefined, campaign: 'x' }).subscribe();
    expect(get).toHaveBeenCalledWith('/admin/analytics/claims-by-source', { campaign: 'x' });
  });
});
