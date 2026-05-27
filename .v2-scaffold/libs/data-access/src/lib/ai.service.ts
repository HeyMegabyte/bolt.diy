/**
 * `AiService` — RxJS-first wrapper for the Wave 1B AI feature surface.
 *
 * Endpoints:
 *   #10 podcastForPage$       → POST /api/ai/podcast
 *   #13 competitorGap$        → POST /api/ai/competitor-gap
 *   #14 searchLogs$           → POST /api/sites/:siteId/logs/search
 *   #18 translateChatMessage$ → POST /api/jobs/:jobId/translate
 *
 * RxJS-first per `[[rxjs-first-angular]]`. Every method returns a cold
 * Observable; callers subscribe via `| async` in templates or pipe through
 * `toSignal()` when a synchronous read is needed.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Observable } from 'rxjs';

export interface PodcastResult {
  readonly audio_url: string;
  readonly duration_ms: number;
  readonly cached: boolean;
}

export interface CompetitorGap {
  readonly name: string;
  readonly suggested_copy: string;
}

export interface CompetitorGapResult {
  readonly id: string;
  readonly missing_sections: ReadonlyArray<CompetitorGap>;
}

export interface LogSearchRow {
  readonly timestamp: string;
  readonly level: string;
  readonly source: string;
  readonly message: string;
  readonly request_id: string | null;
}

export interface LogSearchResult {
  readonly where: string;
  readonly rows: ReadonlyArray<LogSearchRow>;
}

export interface TranslateResult {
  readonly translated_text: string;
  readonly target_lang: string;
  readonly model: string;
  readonly cached: boolean;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly http = inject(HttpClient);

  /** #10 — generate a 60-90 sec spoken podcast for a long-form page. */
  podcastForPage$(args: {
    slug: string;
    body_markdown: string;
    site_id?: string;
  }): Observable<PodcastResult> {
    return this.http.post<PodcastResult>('/api/ai/podcast', args);
  }

  /** #13 — crawl up to 5 competitor URLs and surface missing-section gaps. */
  competitorGap$(args: {
    org_id: string;
    competitor_urls: ReadonlyArray<string>;
    tenant_site_summary?: string;
  }): Observable<CompetitorGapResult> {
    return this.http.post<CompetitorGapResult>('/api/ai/competitor-gap', args);
  }

  /** #14 — natural-language log search ("errors in the last hour"). */
  searchLogs$(siteId: string, query: string): Observable<LogSearchResult> {
    return this.http.post<LogSearchResult>(
      `/api/sites/${encodeURIComponent(siteId)}/logs/search`,
      { query },
    );
  }

  /** #18 — translate a chat message to the requested locale. */
  translateChatMessage$(
    jobId: string,
    text: string,
    target_lang: string,
  ): Observable<TranslateResult> {
    return this.http.post<TranslateResult>(
      `/api/jobs/${encodeURIComponent(jobId)}/translate`,
      { text, target_lang },
    );
  }
}
