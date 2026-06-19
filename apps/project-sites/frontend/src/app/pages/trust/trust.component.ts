import { Component, type OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RevealDirective } from '../../directives/reveal.directive';
import { MetaService } from '../../services/meta.service';

interface Pillar {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
}

/**
 * Public Trust Center (/trust) — backlog #30.
 *
 * @remarks
 * Honest, verifiable security posture. Every pillar maps to a shipped
 * capability: the no-client-secrets build scan (build_validators
 * `validateNoClientSecrets`), the A–F production-readiness grade
 * (`scoreReadiness`), AES-GCM credential encryption (`ai_crypto`), Stripe
 * checkout, Cloudflare Turnstile, and magic-link / Google auth. The
 * "still building" section is candid: SOC 2 Type II is on the roadmap, NOT
 * yet certified — never claim a certification we don't hold.
 *
 * @example
 * <app-trust />
 */
@Component({
  selector: 'app-trust',
  standalone: true,
  imports: [RouterLink, RevealDirective],
  template: `
    <section class="trust-page">
      <div class="trust-inner">
        <header class="trust-header" appReveal>
          <p class="trust-eyebrow">Trust &amp; Security</p>
          <h1>Built to protect your sites, your data, your customers</h1>
          <p class="trust-subtitle">
            No marketing fluff — here's exactly how we keep things safe, and what we're still building.
          </p>
        </header>

        <!-- Proof-point pillars -->
        <div class="trust-grid" appReveal>
          @for (p of pillars; track p.title) {
            <article class="trust-card" appReveal>
              <span class="trust-card__icon" aria-hidden="true">{{ p.icon }}</span>
              <h2 class="trust-card__title">{{ p.title }}</h2>
              <p class="trust-card__body">{{ p.body }}</p>
            </article>
          }
        </div>

        <!-- Candid roadmap -->
        <section class="trust-roadmap" appReveal aria-labelledby="roadmap-h">
          <h2 id="roadmap-h" class="trust-roadmap__title">What we're still building</h2>
          <p class="trust-roadmap__lede">
            We'd rather under-promise. These are in progress — not done yet.
          </p>
          <ul class="trust-roadmap__list">
            @for (item of roadmap; track item) {
              <li class="trust-roadmap__item">
                <span class="trust-roadmap__pill">In progress</span>
                <span>{{ item }}</span>
              </li>
            }
          </ul>
        </section>

        <!-- Report a vulnerability -->
        <section class="trust-report" appReveal aria-labelledby="report-h">
          <h2 id="report-h" class="trust-report__title">Found a vulnerability?</h2>
          <p class="trust-report__body">
            Email <a href="mailto:hey@megabyte.space?subject=Security%20report">hey&#64;megabyte.space</a>
            with the details — we read every report and respond fast. Our
            <a href="/.well-known/security.txt" target="_blank" rel="noopener noreferrer">security.txt</a>
            has the full policy.
          </p>
        </section>
      </div>
    </section>

    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-bottom">
          <span>&copy; 2026 <a href="https://megabyte.space" target="_blank" rel="noopener noreferrer">Megabyte LLC</a></span>
          <span>
            <a routerLink="/privacy">Privacy</a> |
            <a routerLink="/terms">Terms</a> |
            <a routerLink="/trust">Trust</a> |
            <a routerLink="/blog">Blog</a> |
            <a routerLink="/status">Status</a>
          </span>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .trust-page {
      min-height: calc(100vh - 60px - 120px);
      padding: 48px 24px 80px;
      animation: fadeIn 0.3s ease;
    }
    .trust-inner { max-width: 920px; margin: 0 auto; }

    .trust-header { text-align: center; margin-bottom: 48px; }
    .trust-eyebrow {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-size: 0.72rem;
      color: var(--ps-accent, #00e5ff);
      margin: 0 0 12px;
    }
    h1 {
      font-size: clamp(1.9rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      margin: 0 auto 14px;
      max-width: 18ch;
      line-height: 1.1;
      background: linear-gradient(135deg, #fff 0%, rgba(0, 229, 255, 0.85) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .trust-subtitle {
      font-size: 1.05rem;
      color: #94a3b8;
      margin: 0 auto;
      max-width: 52ch;
    }

    .trust-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 56px;
    }
    .trust-card {
      padding: 22px 22px 24px;
      border-radius: 16px;
      background: linear-gradient(145deg, rgba(13, 13, 40, 0.5), rgba(8, 8, 32, 0.7));
      border: 1px solid rgba(0, 229, 255, 0.08);
      transition: transform 0.333s ease, border-color 0.333s ease, box-shadow 0.333s ease;
    }
    .trust-card:hover {
      transform: translateY(-3px);
      border-color: rgba(0, 229, 255, 0.28);
      box-shadow: 0 12px 32px rgba(0, 229, 255, 0.08);
    }
    .trust-card__icon { font-size: 1.6rem; display: block; margin-bottom: 10px; }
    .trust-card__title {
      font-size: 1.02rem;
      font-weight: 700;
      color: #f4f4ff;
      margin: 0 0 8px;
    }
    .trust-card__body { font-size: 0.9rem; line-height: 1.55; color: #a5b0c4; margin: 0; }

    .trust-roadmap {
      padding: 28px 28px 30px;
      border-radius: 18px;
      background: rgba(245, 158, 11, 0.04);
      border: 1px solid rgba(245, 158, 11, 0.14);
      margin-bottom: 40px;
    }
    .trust-roadmap__title { font-size: 1.2rem; font-weight: 700; color: #f4f4ff; margin: 0 0 6px; }
    .trust-roadmap__lede { font-size: 0.92rem; color: #94a3b8; margin: 0 0 18px; }
    .trust-roadmap__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
    .trust-roadmap__item { display: flex; align-items: center; gap: 12px; font-size: 0.92rem; color: #cbd5e1; }
    .trust-roadmap__pill {
      flex-shrink: 0;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 3px 9px;
      border-radius: 999px;
      background: rgba(245, 158, 11, 0.12);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.25);
    }

    .trust-report { text-align: center; padding: 8px 0 0; }
    .trust-report__title { font-size: 1.1rem; font-weight: 700; color: #f4f4ff; margin: 0 0 8px; }
    .trust-report__body { font-size: 0.95rem; line-height: 1.6; color: #a5b0c4; margin: 0 auto; max-width: 48ch; }
    .trust-report__body a { color: var(--ps-accent, #00e5ff); text-decoration: none; }
    .trust-report__body a:hover { text-decoration: underline; }

    .site-footer { border-top: 1px solid rgba(255, 255, 255, 0.06); padding: 28px 24px; }
    .footer-inner { max-width: 920px; margin: 0 auto; }
    .footer-bottom {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 0.82rem;
      color: #64748b;
    }
    .footer-bottom a { color: #94a3b8; text-decoration: none; }
    .footer-bottom a:hover { color: var(--ps-accent, #00e5ff); }

    @media (prefers-reduced-motion: reduce) {
      .trust-page { animation: none; }
      .trust-card { transition: none; }
      .trust-card:hover { transform: none; }
    }
  `],
})
export class TrustComponent implements OnInit {
  private readonly meta = inject(MetaService);

  /** Every pillar is a SHIPPED capability — no aspirational claims here. */
  readonly pillars: readonly Pillar[] = [
    {
      icon: '🛡',
      title: 'No secrets in the browser',
      body: 'Every generated site is scanned before publish. Server-only keys (sk_, AKIA, gh_…) can never ship to a visitor\'s browser — the build fails if they would.',
    },
    {
      icon: '🅰',
      title: 'A–F readiness grade',
      body: 'Each build earns a production-readiness score before it goes live. You see the grade in your dashboard, so a risky site never publishes silently.',
    },
    {
      icon: '🔒',
      title: 'Encrypted at rest',
      body: 'Credentials for the services you connect are sealed with AES-GCM and a per-record key. We can\'t read them, and a database leak can\'t either.',
    },
    {
      icon: '🌐',
      title: 'Edge-served, always SSL',
      body: 'Your site runs on Cloudflare\'s global network with HTTPS on every domain — fast everywhere, encrypted in transit by default.',
    },
    {
      icon: '💳',
      title: 'Payments by Stripe',
      body: 'Checkout runs on Stripe. Card numbers never touch our servers — we only ever see a token, never the PAN.',
    },
    {
      icon: '🤖',
      title: 'Bot-protected forms',
      body: 'Every form is guarded by Cloudflare Turnstile, so spam and credential-stuffing bounce before they reach you.',
    },
    {
      icon: '🔑',
      title: 'Passwordless sign-in',
      body: 'Magic links and Google sign-in only — there\'s no password to phish, reuse, or leak.',
    },
    {
      icon: '📤',
      title: 'Your data is yours',
      body: 'Export or delete your data anytime. Email hey@megabyte.space and we\'ll action it — no lock-in, no dark patterns.',
    },
  ];

  /** Candid roadmap — these are NOT done. Never imply otherwise. */
  readonly roadmap: readonly string[] = [
    'SOC 2 Type II — independent audit on our roadmap; not yet certified',
    'Self-serve one-click data export + deletion endpoint',
    'Third-party penetration test with a public summary',
  ];

  ngOnInit(): void {
    this.meta.setMeta({
      title: 'Trust & Security | Project Sites',
      description:
        'How Project Sites protects your sites and data: no secrets in the browser, A–F readiness grades, encrypted credentials, Stripe payments, and Turnstile-guarded forms.',
      canonical: 'https://projectsites.dev/trust',
    });
    this.meta.setJsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Trust & Security',
      description:
        'Security posture for Project Sites — no client-side secrets, production-readiness grading, encryption at rest, and candid roadmap.',
      url: 'https://projectsites.dev/trust',
    });
  }
}
