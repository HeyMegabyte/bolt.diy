import { Component, inject } from '@angular/core';
import { AdminStateService } from '../admin-state.service';
import { HlmInputDirective } from '../../../ui';
import { RollingCounterComponent } from '../../../components/rolling-counter/rolling-counter.component';
import { RevealDirective } from '../../../directives/reveal.directive';

@Component({
  selector: 'app-admin-seo',
  standalone: true,
  imports: [RevealDirective, HlmInputDirective, RollingCounterComponent],
  template: `
    <div class="p-7 flex-1 overflow-y-auto animate-fade-in max-md:p-4 space-y-6" data-testid="seo-section">

      <!-- Header -->
      <div class="seo-header">
        <div class="kicker">Discovery</div>
        <h2 class="section-h text-lg font-bold text-white m-0">SEO</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Optimize your site for search engines and social sharing.</p>
      </div>

      <!-- Meta Tags -->
      <div class="seo-card group" appReveal>
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg class="seo-card-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Meta Tags
          </h3>
          <span class="seo-pill seo-pill-coming">Coming soon</span>
        </div>
        <p class="text-[0.72rem] text-text-secondary/70 m-0 mb-4">Meta tags are auto-generated from your business profile. Manual overrides land in a future release.</p>
        <div class="flex flex-col gap-4 opacity-60 pointer-events-none select-none">
          <div>
            <label class="block text-[0.78rem] font-semibold text-text-secondary mb-2">Page Title</label>
            <input hlmInput type="text" [placeholder]="siteTitle + ' | ' + siteName" disabled />
          </div>
          <div>
            <label class="block text-[0.78rem] font-semibold text-text-secondary mb-2">Meta Description</label>
            <textarea hlmInput class="!h-20 resize-none" placeholder="Describe your business in 1-2 sentences for search results..." disabled></textarea>
          </div>
          <div>
            <label class="block text-[0.78rem] font-semibold text-text-secondary mb-2">Keywords</label>
            <input hlmInput type="text" placeholder="keyword1, keyword2, keyword3" disabled />
          </div>
        </div>
      </div>

      <!-- Search Preview -->
      <div class="seo-card group" appReveal>
        <h3 class="text-base font-semibold text-white m-0 mb-4">Google Search Preview</h3>
        <div class="search-preview bg-white rounded-xl p-4 max-w-[600px]">
          <div class="text-[0.72rem] text-[#202124] mb-0.5 font-sans">{{ siteDomain }}</div>
          <div class="search-preview-title text-[1.05rem] text-[#1a0dab] font-sans leading-tight mb-1 cursor-pointer">
            {{ siteTitle }} | {{ siteName }}
          </div>
          <div class="text-[0.82rem] text-[#4d5156] font-sans leading-snug">
            Your site description will appear here once meta overrides ship. Until then we generate one from your business profile.
          </div>
        </div>
      </div>

      <!-- JSON-LD Preview -->
      <div class="seo-card group" appReveal>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg class="seo-card-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            Structured Data (JSON-LD)
          </h3>
          <span class="seo-pill seo-pill-auto">Example</span>
        </div>
        <p class="text-[0.72rem] text-text-secondary m-0 mb-3">Every page emits LocalBusiness + WebPage JSON-LD; FAQPage and BreadcrumbList are added where applicable. Representative example for this site:</p>
        <div class="json-ld-block bg-[rgba(6,6,18,0.85)] border border-primary/[0.06] rounded-lg p-4 font-mono text-[0.7rem] text-text-secondary/70 overflow-x-auto leading-relaxed" tabindex="0" role="region" aria-label="JSON-LD example — scroll horizontally">
          <pre class="m-0 whitespace-pre-wrap">{{ jsonLdPreview }}</pre>
        </div>
      </div>

      <!-- SEO Checklist -->
      <div class="seo-card" appReveal>
        <h3 class="text-base font-semibold text-white m-0 mb-1 flex items-center gap-2">
          SEO Checklist
          <span class="seo-score" data-numeric><app-rolling-counter [value]="guaranteedCount" [duration]="1100" /> guaranteed</span>
        </h3>
        <p class="text-[0.72rem] text-text-secondary m-0 mb-4">Items the platform guarantees for every generated site, plus content checks worth reviewing yourself.</p>
        <div class="flex flex-col gap-2" role="list" aria-label="SEO checklist">
          @for (check of seoChecks; track check.label; let i = $index) {
            <div class="checklist-row" [class.checklist-row-pass]="check.kind === 'guaranteed'" [class.checklist-row-fail]="check.kind === 'review'"
                 tabindex="0" role="listitem" [attr.aria-label]="(check.kind === 'guaranteed' ? 'Guaranteed: ' : 'Review: ') + check.label"
                 [style.animation-delay.ms]="i * 40">
              <span class="checklist-icon-wrap" [class.checklist-icon-pass]="check.kind === 'guaranteed'" [class.checklist-icon-fail]="check.kind === 'review'">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  @if (check.kind === 'guaranteed') {
                    <polyline points="20 6 9 17 4 12"/>
                  } @else {
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  }
                </svg>
              </span>
              <span class="checklist-label">{{ check.label }}</span>
              <span class="checklist-tag ml-auto">{{ check.kind === 'guaranteed' ? 'Guaranteed' : 'Review' }}</span>
            </div>
          }
        </div>
      </div>

    </div>
  `,
  styles: [`
    :host {
      --ease-cinematic: cubic-bezier(0.4, 0, 0.2, 1);
      --ease-elastic: cubic-bezier(0.34, 1.56, 0.64, 1);
      --ring-cyan: 0 0 0 2px #000, 0 0 0 4px rgba(0, 229, 255, 0.5);
    }

    .seo-header {
      animation: fadeUp 500ms var(--ease-cinematic);
    }

    .seo-card {
      position: relative;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      padding: 1.5rem;
      transition: border-color 280ms var(--ease-cinematic), transform 280ms var(--ease-cinematic), box-shadow 280ms var(--ease-cinematic);
      overflow: hidden;
    }
    .seo-card::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.05), transparent 55%);
      opacity: 0;
      transition: opacity 320ms var(--ease-cinematic);
      pointer-events: none;
    }
    .seo-card:hover {
      border-color: rgba(0, 229, 255, 0.22);
      transform: translateY(-2px);
      box-shadow:
        0 16px 40px -22px rgba(0, 229, 255, 0.28),
        inset 0 0 0 1px rgba(0, 229, 255, 0.04);
    }
    .seo-card:hover::before { opacity: 1; }

    .seo-card-icon {
      transition: transform 320ms var(--ease-elastic), color 280ms var(--ease-cinematic);
    }
    .seo-card:hover .seo-card-icon {
      transform: rotate(-8deg) scale(1.1);
      color: rgba(0, 229, 255, 0.95);
    }

    .seo-pill {
      font-size: 0.62rem;
      font-weight: 700;
      padding: 0.125rem 0.625rem;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      transition: transform 240ms var(--ease-elastic), box-shadow 280ms var(--ease-cinematic);
    }
    .seo-pill-coming {
      background: rgba(0, 229, 255, 0.1);
      color: rgba(0, 229, 255, 1);
    }
    .seo-pill-auto {
      background: rgba(34, 197, 94, 0.1);
      color: rgba(74, 222, 128, 1);
    }
    .seo-card:hover .seo-pill {
      transform: scale(1.06);
      box-shadow: 0 4px 12px -4px currentColor;
    }

    .seo-score {
      font-size: 0.62rem;
      font-weight: 700;
      padding: 0.125rem 0.5rem;
      border-radius: 6px;
      background: linear-gradient(135deg, rgba(0, 229, 255, 0.18), rgba(124, 58, 237, 0.18));
      color: rgba(0, 229, 255, 1);
      letter-spacing: 0.04em;
      font-variant-numeric: tabular-nums;
    }

    .search-preview {
      transition: box-shadow 320ms var(--ease-cinematic), transform 320ms var(--ease-cinematic);
    }
    .seo-card:hover .search-preview {
      box-shadow: 0 12px 28px -16px rgba(0, 0, 0, 0.4);
      transform: translateY(-1px);
    }
    .search-preview-title {
      position: relative;
      display: inline-block;
      transition: color 200ms var(--ease-cinematic);
    }
    .search-preview-title::after {
      content: '';
      position: absolute;
      left: 0; right: 100%;
      bottom: -1px;
      height: 1px;
      background: currentColor;
      transition: right 360ms var(--ease-cinematic);
    }
    .search-preview-title:hover::after { right: 0; }

    .json-ld-block {
      transition: border-color 280ms var(--ease-cinematic), background 280ms var(--ease-cinematic);
    }
    .seo-card:hover .json-ld-block {
      border-color: rgba(0, 229, 255, 0.18);
      background: rgba(6, 6, 18, 0.92);
    }

    .checklist-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.6rem 0.85rem;
      background: rgba(255, 255, 255, 0.012);
      border: 1px solid transparent;
      border-radius: 10px;
      cursor: default;
      animation: slideIn 420ms var(--ease-cinematic) backwards;
      transition: background 220ms var(--ease-cinematic), border-color 220ms var(--ease-cinematic), transform 220ms var(--ease-cinematic);
    }
    .checklist-row:hover {
      background: rgba(255, 255, 255, 0.04);
      transform: translateX(3px);
    }
    .checklist-row-pass:hover {
      border-color: rgba(74, 222, 128, 0.22);
    }
    .checklist-row-fail:hover {
      border-color: rgba(251, 191, 36, 0.28);
    }
    .checklist-row:focus-visible {
      outline: none;
      box-shadow: var(--ring-cyan);
      border-color: rgba(0, 229, 255, 0.4);
    }
    .checklist-row:active {
      transform: translateX(3px) scale(0.99);
      transition-duration: 80ms;
    }

    .checklist-icon-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 7px;
      transition: transform 280ms var(--ease-elastic), box-shadow 280ms var(--ease-cinematic);
      flex-shrink: 0;
    }
    .checklist-icon-pass {
      background: rgba(34, 197, 94, 0.14);
      color: rgba(74, 222, 128, 1);
    }
    .checklist-icon-fail {
      background: rgba(251, 191, 36, 0.14);
      color: rgba(251, 191, 36, 1);
    }
    .checklist-row:hover .checklist-icon-wrap {
      transform: scale(1.12) rotate(-4deg);
    }
    .checklist-row-pass:hover .checklist-icon-wrap {
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.1);
    }
    .checklist-row-fail:hover .checklist-icon-wrap {
      box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.1);
    }

    .checklist-tag {
      font-size: 0.58rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.1rem 0.4rem;
      border-radius: 5px;
      flex-shrink: 0;
    }
    .checklist-row-pass .checklist-tag { background: rgba(34, 197, 94, 0.12); color: rgba(74, 222, 128, 0.95); }
    .checklist-row-fail .checklist-tag { background: rgba(251, 191, 36, 0.12); color: rgba(251, 191, 36, 0.95); }

    .checklist-label {
      font-size: 0.78rem;
      transition: color 200ms var(--ease-cinematic), letter-spacing 280ms var(--ease-cinematic);
    }
    .checklist-row-pass .checklist-label { color: rgba(255, 255, 255, 0.82); }
    .checklist-row-fail .checklist-label { color: rgba(251, 191, 36, 0.82); }
    .checklist-row:hover .checklist-label {
      color: #fff;
      letter-spacing: 0.005em;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateX(-8px); }
      to { opacity: 1; transform: translateX(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      .seo-header, .checklist-row { animation: none; }
      .seo-card, .seo-card::before, .search-preview, .search-preview-title::after,
      .json-ld-block, .checklist-row, .checklist-icon-wrap, .checklist-label,
      .seo-card-icon, .seo-pill {
        transition-duration: 0ms;
      }
      .seo-card:hover, .checklist-row:hover, .search-preview:hover {
        transform: none;
      }
    }
  `],
})
export class AdminSeoComponent {
  state = inject(AdminStateService);

  get siteName(): string {
    return this.state.selectedSite()?.business_name || 'Your Business';
  }

  get siteTitle(): string {
    return this.state.selectedSite()?.business_name || 'Your Site Title';
  }

  get siteDomain(): string {
    const slug = this.state.selectedSite()?.slug || 'your-site';
    return `${slug}.projectsites.dev`;
  }

  get jsonLdPreview(): string {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: this.siteName,
      url: `https://${this.siteDomain}`,
      sameAs: [],
    }, null, 2);
  }

  get guaranteedCount(): number {
    return this.seoChecks.filter(c => c.kind === 'guaranteed').length;
  }

  /**
   * Honest framing (no fake per-site audit/score): `guaranteed` items are SEO
   * invariants the platform enforces for EVERY generated site (see the worker
   * build_validators — title length, meta, JSON-LD, robots, sitemap+lastmod,
   * OG, canonical, single-H1). `review` items are content-dependent and can't be
   * asserted per-site without a real audit, so they're surfaced as "review",
   * not a fabricated pass/fail.
   */
  readonly seoChecks: { label: string; kind: 'guaranteed' | 'review' }[] = [
    { label: 'Page title under 60 characters', kind: 'guaranteed' },
    { label: 'Meta description present (120–156 chars)', kind: 'guaranteed' },
    { label: 'LocalBusiness + WebPage JSON-LD emitted', kind: 'guaranteed' },
    { label: 'robots.txt allows crawling', kind: 'guaranteed' },
    { label: 'sitemap.xml generated with lastmod', kind: 'guaranteed' },
    { label: 'Open Graph + Twitter Card tags present', kind: 'guaranteed' },
    { label: 'Canonical URL on every page', kind: 'guaranteed' },
    { label: 'Exactly one H1 per page', kind: 'guaranteed' },
    { label: 'Descriptive image alt text', kind: 'review' },
    { label: 'Internal links use descriptive anchors', kind: 'review' },
  ];
}
