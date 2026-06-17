import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterGroup {
  heading: string;
  links: FooterLink[];
}

export interface FooterSocial {
  label: string;
  href: string;
  /** Inline SVG path data for the icon */
  svgPath: string;
}

@Component({
  selector: 'sk-site-footer',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    .sf-social:hover { opacity: 1; }
    .sf-link:hover { opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      .sf-social, .sf-link { transition: none !important; }
    }
  `],
  template: `
    <footer
      [style.background]="'var(--ps-bg,#060610)'"
      [style.color]="'var(--ps-ink,#f4f4ff)'"
      [style.borderTop]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'">

      <!-- Main grid -->
      <div style="max-width:1200px;margin:0 auto;padding:4rem 1.5rem 3rem;">
        <div style="display:grid;gap:3rem;grid-template-columns:2fr repeat(3,1fr);" class="sf-grid">

          <!-- Brand column -->
          <div>
            <p [style.color]="'var(--ps-accent,#00e5ff)'"
               style="font-size:1.25rem;font-weight:800;letter-spacing:-.02em;margin:0 0 .875rem;">
              {{ brand }}
            </p>
            <p style="opacity:.55;font-size:.9rem;line-height:1.7;max-width:30ch;margin:0 0 1.5rem;">
              {{ tagline }}
            </p>

            <!-- Social links -->
            <div *ngIf="socials.length" style="display:flex;gap:.75rem;flex-wrap:wrap;">
              <a *ngFor="let s of socials"
                 class="sf-social"
                 [href]="s.href"
                 [attr.aria-label]="s.label"
                 target="_blank"
                 rel="noopener noreferrer"
                 style="display:flex;align-items:center;justify-content:center;
                        width:36px;height:36px;border-radius:50%;opacity:.55;
                        transition:opacity .15s;flex-shrink:0;"
                 [style.border]="'1px solid var(--ps-hairline,rgba(255,255,255,.15))'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                     [attr.aria-hidden]="true">
                  <path [attr.d]="s.svgPath" />
                </svg>
              </a>
            </div>
          </div>

          <!-- Nav groups -->
          <div *ngFor="let group of groups">
            <p [style.color]="'var(--ps-accent,#00e5ff)'"
               style="font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
                      margin:0 0 1rem;">
              {{ group.heading }}
            </p>
            <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5rem;">
              <li *ngFor="let link of group.links">
                <a class="sf-link"
                   [href]="link.href"
                   style="opacity:.55;font-size:.9rem;text-decoration:none;
                          transition:opacity .15s;display:inline-block;"
                   [style.color]="'var(--ps-ink,#f4f4ff)'">
                  {{ link.label }}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Bottom bar -->
      <div [style.borderTop]="'1px solid var(--ps-hairline,rgba(255,255,255,.06))'">
        <div style="max-width:1200px;margin:0 auto;padding:1.25rem 1.5rem;
                    display:flex;align-items:center;justify-content:space-between;
                    flex-wrap:wrap;gap:.75rem;">
          <p style="opacity:.4;font-size:.8rem;margin:0;">{{ copyright }}</p>
          <div *ngIf="legalLinks.length"
               style="display:flex;gap:1.25rem;flex-wrap:wrap;">
            <a *ngFor="let l of legalLinks"
               class="sf-link"
               [href]="l.href"
               style="opacity:.4;font-size:.8rem;text-decoration:none;transition:opacity .15s;"
               [style.color]="'var(--ps-ink,#f4f4ff)'">
              {{ l.label }}
            </a>
          </div>
        </div>
      </div>
    </footer>
  `,
})
export class SkSiteFooterComponent {
  @Input() brand = 'Acme Co.';
  @Input() tagline = 'Building great products for the people who matter most.';
  @Input() copyright = `© ${new Date().getFullYear()} Acme Co. All rights reserved.`;

  @Input() groups: FooterGroup[] = [
    {
      heading: 'Product',
      links: [
        { label: 'Features', href: '#features' },
        { label: 'Pricing', href: '#pricing' },
        { label: 'Changelog', href: '#changelog' },
        { label: 'Roadmap', href: '#roadmap' },
      ],
    },
    {
      heading: 'Company',
      links: [
        { label: 'About', href: '#about' },
        { label: 'Blog', href: '#blog' },
        { label: 'Careers', href: '#careers' },
        { label: 'Press', href: '#press' },
      ],
    },
    {
      heading: 'Support',
      links: [
        { label: 'Docs', href: '#docs' },
        { label: 'Status', href: '#status' },
        { label: 'Contact', href: '#contact' },
      ],
    },
  ];

  @Input() socials: FooterSocial[] = [
    {
      label: 'Twitter / X',
      href: 'https://x.com',
      svgPath: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z',
    },
    {
      label: 'GitHub',
      href: 'https://github.com',
      svgPath:
        'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22',
    },
    {
      label: 'LinkedIn',
      href: 'https://linkedin.com',
      svgPath:
        'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z M4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    },
  ];

  @Input() legalLinks: FooterLink[] = [
    { label: 'Privacy Policy', href: '#privacy' },
    { label: 'Terms of Service', href: '#terms' },
    { label: 'Cookie Policy', href: '#cookies' },
  ];
}
