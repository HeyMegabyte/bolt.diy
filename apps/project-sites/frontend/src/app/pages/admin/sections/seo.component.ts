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
      <div class="seo-header" appReveal>
        <div class="kicker">Discovery</div>
        <h2 class="section-h text-lg font-bold text-white m-0">SEO</h2>
        <p class="text-[0.78rem] text-text-secondary m-0 mt-1">Optimize your site for search engines and social sharing.</p>
      </div>

      <!-- Coverage summary strip (cyan/black UX win) -->
      <!-- a11y: each stat is differentiated visually by colour (green/amber/cyan) + position
           only. Each is exposed as its OWN labelled figure so AT announces "8 guaranteed SEO
           checks" as one unit (number + colour-encoded meaning), with the inner counter + label
           hidden so the figure isn't double-read (WCAG 1.3.1 / 1.4.1 / 4.1.2). -->
      <div class="seo-summary" appReveal role="group" aria-label="SEO coverage summary">
        <div class="seo-summary-stat" data-numeric role="group"
             [attr.aria-label]="guaranteedCount + ' guaranteed SEO checks'">
          <span class="seo-summary-num seo-summary-pass" aria-hidden="true"><app-rolling-counter [value]="guaranteedCount" [duration]="1100" /></span>
          <span class="seo-summary-label" aria-hidden="true">Guaranteed</span>
        </div>
        <div class="seo-summary-divider" aria-hidden="true"></div>
        <div class="seo-summary-stat" data-numeric role="group"
             [attr.aria-label]="reviewCount + ' checks to review'">
          <span class="seo-summary-num seo-summary-review" aria-hidden="true"><app-rolling-counter [value]="reviewCount" [duration]="1100" /></span>
          <span class="seo-summary-label" aria-hidden="true">To review</span>
        </div>
        <div class="seo-summary-divider" aria-hidden="true"></div>
        <div class="seo-summary-stat" data-numeric role="group"
             [attr.aria-label]="totalCount + ' SEO checks total'">
          <span class="seo-summary-num seo-summary-total" aria-hidden="true"><app-rolling-counter [value]="totalCount" [duration]="1100" /></span>
          <span class="seo-summary-label" aria-hidden="true">Checks</span>
        </div>
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
          <div class="search-preview-title text-[1.05rem] text-[#1a0dab] font-sans leading-tight mb-1">
            {{ siteTitle }} | {{ siteName }}
          </div>
          <div class="text-[0.82rem] text-[#4d5156] font-sans leading-snug">
            Your site description will appear here once meta overrides ship. Until then we generate one from your business profile.
          </div>
        </div>
      </div>

      <!-- Social Share Preview -->
      <div class="seo-card group" appReveal data-testid="seo-social-preview">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-semibold text-white m-0 flex items-center gap-2">
            <svg class="seo-card-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Social Share Preview
          </h3>
          <span class="seo-pill seo-pill-auto">Auto</span>
        </div>
        <p class="text-[0.72rem] text-text-secondary m-0 mb-3">How your link looks when shared on X, LinkedIn, Facebook, and iMessage — every page emits a branded 1200×630 Open Graph card.</p>
        <div class="social-card max-w-[520px]">
          <div class="social-card-img" aria-hidden="true">
            <span class="social-card-img-name">{{ siteName }}</span>
            <span class="social-card-img-dim">Open Graph · 1200 × 630</span>
          </div>
          <div class="social-card-meta">
            <div class="social-card-domain">{{ siteDomain }}</div>
            <div class="social-card-title">{{ siteTitle }} | {{ siteName }}</div>
            <div class="social-card-desc">Your Open Graph description is generated from your business profile until manual overrides ship.</div>
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
      /* Section-local accent driven from the global brand token so the whole
         section tracks any future --ps-accent change instead of hardcoding cyan. */
      --seo-accent: var(--ps-accent, #00e5ff);
      --seo-pass: #4ade80;
      --seo-review: #fbbf24;
      --ring-cyan: 0 0 0 2px var(--ps-bg, #060610),
        0 0 0 4px color-mix(in oklch, var(--seo-accent) 55%, transparent);
    }

    .seo-header {
      animation: fadeUp 500ms var(--ease-cinematic);
    }

    /* Social-share (Open Graph) card mockup — token-driven so it tracks --ps-accent. */
    .social-card { border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; overflow: hidden; background: rgba(255, 255, 255, 0.02); }
    .social-card-img {
      aspect-ratio: 1200 / 630;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.4rem;
      background: linear-gradient(135deg, color-mix(in oklch, var(--seo-accent) 20%, #060610), #0a0a18 72%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .social-card-img-name { font-size: 1.4rem; font-weight: 700; color: #fff; letter-spacing: -0.01em; text-align: center; padding: 0 1rem; line-height: 1.15; }
    .social-card-img-dim { font-size: 0.66rem; letter-spacing: 0.05em; color: color-mix(in oklch, var(--seo-accent) 72%, #fff); font-family: ui-monospace, monospace; }
    .social-card-meta { padding: 0.65rem 0.9rem; }
    .social-card-domain { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary, #94a3b8); }
    .social-card-title { font-size: 0.9rem; font-weight: 600; color: #fff; margin-top: 0.1rem; line-height: 1.25; }
    .social-card-desc { font-size: 0.74rem; color: color-mix(in oklch, var(--text-secondary, #94a3b8) 92%, transparent); margin-top: 0.15rem; line-height: 1.35; }

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
      background: linear-gradient(135deg, color-mix(in oklch, var(--seo-accent) 5%, transparent), transparent 55%);
      opacity: 0;
      transition: opacity 320ms var(--ease-cinematic);
      pointer-events: none;
    }
    .seo-card:hover,
    .seo-card:focus-within {
      border-color: color-mix(in oklch, var(--seo-accent) 22%, transparent);
      transform: translateY(-2px);
      box-shadow:
        0 16px 40px -22px color-mix(in oklch, var(--seo-accent) 28%, transparent),
        inset 0 0 0 1px color-mix(in oklch, var(--seo-accent) 4%, transparent);
    }
    .seo-card:hover::before,
    .seo-card:focus-within::before { opacity: 1; }
    .seo-card:focus-visible {
      outline: none;
      box-shadow: var(--ring-cyan);
      border-color: color-mix(in oklch, var(--seo-accent) 40%, transparent);
    }

    .seo-card-icon {
      transition: transform 320ms var(--ease-elastic), color 280ms var(--ease-cinematic);
    }
    .seo-card:hover .seo-card-icon {
      transform: rotate(-8deg) scale(1.1);
      color: var(--seo-accent);
    }

    /* Coverage summary strip — cyan/black UX win */
    .seo-summary {
      display: flex;
      align-items: stretch;
      gap: 0.25rem;
      padding: 0.85rem 1.1rem;
      border-radius: 14px;
      background:
        linear-gradient(135deg, color-mix(in oklch, var(--seo-accent) 9%, transparent), transparent 60%),
        rgba(255, 255, 255, 0.02);
      border: 1px solid color-mix(in oklch, var(--seo-accent) 14%, transparent);
    }
    .seo-summary-stat {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.15rem;
      text-align: center;
    }
    .seo-summary-num {
      font-size: 1.6rem;
      font-weight: 800;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .seo-summary-pass { color: var(--seo-pass); }
    .seo-summary-review { color: var(--seo-review); }
    .seo-summary-total { color: var(--seo-accent); }
    .seo-summary-label {
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-secondary, rgba(244, 244, 255, 0.65));
    }
    .seo-summary-divider {
      width: 1px;
      align-self: center;
      height: 2.2rem;
      background: color-mix(in oklch, var(--seo-accent) 18%, transparent);
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
      background: color-mix(in oklch, var(--seo-accent) 10%, transparent);
      color: var(--seo-accent);
    }
    .seo-pill-auto {
      background: color-mix(in oklch, var(--seo-pass) 12%, transparent);
      color: var(--seo-pass);
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
      background: linear-gradient(135deg,
        color-mix(in oklch, var(--seo-accent) 18%, transparent),
        color-mix(in oklch, var(--ps-accent-secondary, #7c3aed) 18%, transparent));
      color: var(--seo-accent);
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
    /* Display-only Google-preview title — no link affordance (it isn't clickable). */
    .search-preview-title {
      display: inline-block;
    }

    .json-ld-block {
      transition: border-color 280ms var(--ease-cinematic), background 280ms var(--ease-cinematic);
    }
    .json-ld-block:focus-visible {
      outline: none;
      box-shadow: var(--ring-cyan);
    }
    .seo-card:hover .json-ld-block,
    .seo-card:focus-within .json-ld-block {
      border-color: color-mix(in oklch, var(--seo-accent) 18%, transparent);
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
      border-color: color-mix(in oklch, var(--seo-pass) 22%, transparent);
    }
    .checklist-row-fail:hover {
      border-color: color-mix(in oklch, var(--seo-review) 28%, transparent);
    }
    .checklist-row:focus-visible {
      outline: none;
      box-shadow: var(--ring-cyan);
      border-color: color-mix(in oklch, var(--seo-accent) 40%, transparent);
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
      background: color-mix(in oklch, var(--seo-pass) 14%, transparent);
      color: var(--seo-pass);
    }
    .checklist-icon-fail {
      background: color-mix(in oklch, var(--seo-review) 14%, transparent);
      color: var(--seo-review);
    }
    .checklist-row:hover .checklist-icon-wrap {
      transform: scale(1.12) rotate(-4deg);
    }
    .checklist-row-pass:hover .checklist-icon-wrap {
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--seo-pass) 10%, transparent);
    }
    .checklist-row-fail:hover .checklist-icon-wrap {
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--seo-review) 10%, transparent);
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
    .checklist-row-pass .checklist-tag { background: color-mix(in oklch, var(--seo-pass) 12%, transparent); color: var(--seo-pass); }
    .checklist-row-fail .checklist-tag { background: color-mix(in oklch, var(--seo-review) 12%, transparent); color: var(--seo-review); }

    .checklist-label {
      font-size: 0.78rem;
      transition: color 200ms var(--ease-cinematic), letter-spacing 280ms var(--ease-cinematic);
    }
    .checklist-row-pass .checklist-label { color: rgba(255, 255, 255, 0.82); }
    .checklist-row-fail .checklist-label { color: color-mix(in oklch, var(--seo-review) 82%, transparent); }
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
      .seo-card, .seo-card::before, .search-preview,
      .json-ld-block, .checklist-row, .checklist-icon-wrap, .checklist-label,
      .seo-card-icon, .seo-pill, .seo-summary {
        transition-duration: 0ms;
      }
      .seo-card:hover, .seo-card:focus-within,
      .checklist-row:hover, .search-preview:hover {
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

  get reviewCount(): number {
    return this.seoChecks.filter(c => c.kind === 'review').length;
  }

  get totalCount(): number {
    return this.seoChecks.length;
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
