/**
 * ActivationAnalyticsService — the admin dashboard's typed data layer over the
 * Tinybird-backed analytics endpoints (§9 revenue machine).
 *
 * @remarks
 * Wraps the four super-admin read endpoints the worker exposes
 * (`activation-funnel`, `events-daily`, `publishes-by-source`,
 * `claims-by-source`) behind typed methods, so the panel component never
 * hand-builds URLs or params. Auth (bearer) + timeout come from {@link ApiService}.
 *
 * Every response carries `degraded` — `true` when Tinybird is unconfigured or
 * down, in which case `stages`/`rows` are the zero-state. The panel renders the
 * shells either way and shows a "provisioning" note when `degraded`.
 *
 * @example
 * const analytics = inject(ActivationAnalyticsService);
 * analytics.getActivationFunnel({ days: 30 }).subscribe((r) => this.funnel.set(r));
 */
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import { ApiService } from './api.service';

/** One funnel stage row (mirrors the worker `ActivationFunnelRow`). */
export interface FunnelStage {
  stage: string;
  label: string;
  ordinal: number;
  events: number;
  sites: number;
}

/** Per-stage conversion (mirrors `FunnelConversionStep`). */
export interface FunnelConversionStep {
  stage: string;
  label: string;
  ordinal: number;
  sites: number;
  /** sites ÷ previous-stage sites, %, 1dp. `null` at the top OR when prev is 0. */
  fromPrevPct: number | null;
  /** sites ÷ top-stage sites, %, 1dp. */
  fromTopPct: number;
}

/** The funnel's conversion view (mirrors `FunnelConversion`). */
export interface FunnelConversion {
  steps: FunnelConversionStep[];
  topSites: number;
  bottomSites: number;
  overallPct: number;
}

/** `GET /api/admin/activation-funnel` response. */
export interface ActivationFunnelResponse {
  stages: FunnelStage[];
  conversion: FunnelConversion;
  /** True when the data is the zero fallback (Tinybird unconfigured/down). */
  degraded: boolean;
  count: number;
}

/** A row from `events_by_tenant_daily`. */
export interface EventsDailyRow {
  tenant_id: string;
  day: string;
  event: string;
  events: number;
}

/** A row from `site_publishes_by_source`. */
export interface PublishesBySourceRow {
  tenant_id: string;
  day: string;
  source: string;
  publishes: number;
}

/** A row from `claims_by_source`. */
export interface ClaimsBySourceRow {
  tenant_id: string;
  day: string;
  source: string;
  campaign: string;
  claims: number;
}

/** A raw-rollup endpoint response (`events-daily` / `publishes-by-source` / `claims-by-source`). */
export interface RollupResponse<T> {
  rows: T[];
  degraded: boolean;
  count: number;
}

/** Common narrowing params accepted by the analytics endpoints. */
export interface AnalyticsQuery {
  tenant_id?: string;
  days?: number;
  event?: string;
  source?: string;
  campaign?: string;
}

/** Drop undefined params + stringify (HttpParams wants string values). */
function toParams(q: AnalyticsQuery): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') out[k] = String(v);
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class ActivationAnalyticsService {
  private api = inject(ApiService);

  /** The revenue funnel + derived conversion for the activation dashboard. */
  getActivationFunnel(q: AnalyticsQuery = {}): Observable<ActivationFunnelResponse> {
    return this.api.get<ActivationFunnelResponse>('/admin/activation-funnel', toParams(q));
  }

  /** Per-tenant / per-day / per-type event rollup. */
  getEventsDaily(q: AnalyticsQuery = {}): Observable<RollupResponse<EventsDailyRow>> {
    return this.api.get<RollupResponse<EventsDailyRow>>('/admin/analytics/events-daily', toParams(q));
  }

  /** Per-tenant publish counts by source (editor vs claim vs workflow). */
  getPublishesBySource(q: AnalyticsQuery = {}): Observable<RollupResponse<PublishesBySourceRow>> {
    return this.api.get<RollupResponse<PublishesBySourceRow>>(
      '/admin/analytics/publishes-by-source',
      toParams(q),
    );
  }

  /** Per-tenant claim-start counts by source + campaign (acquisition attribution). */
  getClaimsBySource(q: AnalyticsQuery = {}): Observable<RollupResponse<ClaimsBySourceRow>> {
    return this.api.get<RollupResponse<ClaimsBySourceRow>>(
      '/admin/analytics/claims-by-source',
      toParams(q),
    );
  }
}
