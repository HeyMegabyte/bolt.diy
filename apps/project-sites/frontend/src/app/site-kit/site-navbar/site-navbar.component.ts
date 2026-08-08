import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface NavLink { label: string; href: string; }

@Component({
  selector: 'sk-site-navbar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header
      [style.background]="'var(--ps-bg,#060610)'"
      [style.borderBottom]="'1px solid var(--ps-hairline,rgba(255,255,255,.08))'"
      style="position:sticky;top:0;z-index:var(--ps-z-sticky,200);">
      <nav
        style="max-width:1200px;margin:0 auto;padding:0 1.5rem;
               display:flex;align-items:center;justify-content:space-between;height:64px;">
        <!-- Brand -->
        <a [href]="logoHref"
           [style.color]="'var(--ps-accent,#00e5ff)'"
           style="font-size:1.25rem;font-weight:700;text-decoration:none;letter-spacing:-.02em;">
          {{ brandName }}
        </a>

        <!-- Links -->
        <ul *ngIf="links.length"
            style="display:flex;gap:2rem;list-style:none;margin:0;padding:0;"
            role="list">
          <li *ngFor="let link of links">
            <a [href]="link.href"
               [style.color]="'var(--ps-ink,#f4f4ff)'"
               style="text-decoration:none;font-size:.95rem;opacity:.85;
                      transition:opacity .15s;outline:var(--ps-ring-focus);"
               (mouseenter)="$event.target['style'].opacity='1'"
               (mouseleave)="$event.target['style'].opacity='.85'">
              {{ link.label }}
            </a>
          </li>
        </ul>

        <!-- CTA -->
        <a [href]="ctaHref"
           [style.background]="'var(--ps-grad-primary,linear-gradient(135deg,#00e5ff,#00d4ff))'"
           [style.color]="'var(--ps-bg,#060610)'"
           style="padding:.5rem 1.25rem;border-radius:var(--ps-radius-sm,8px);
                  font-weight:600;font-size:.9rem;text-decoration:none;
                  transition:opacity .15s;white-space:nowrap;"
           (mouseenter)="$event.target['style'].opacity='.85'"
           (mouseleave)="$event.target['style'].opacity='1'">
          {{ ctaLabel }}
        </a>
      </nav>
    </header>
  `,
})
export class SkSiteNavbarComponent {
  @Input() brandName = 'Acme Inc.';
  @Input() logoHref = '/';
  @Input() ctaLabel = 'Get Started';
  @Input() ctaHref = '#contact';
  // No fabricated defaults — a kit navbar must NEVER ship invented nav links (#features
  // / #pricing anchors that may not exist on the real site). Empty by default → the
  // <ul> self-hides (*ngIf). The consumer passes the business's REAL nav. (anti-fabrication mandate)
  @Input() links: NavLink[] = [];
}
