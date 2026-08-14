import { Component, Input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';

export interface MenuItem {
  name: string;
  description?: string;
  price?: number;
  badge?: string;
  dietary?: string[];
}

export interface MenuCategory {
  title: string;
  items: MenuItem[];
}

@Component({
  selector: 'sk-menu-board',
  standalone: true,
  imports: [CurrencyPipe],
  template: `
    @if (categories.length) {
      <section
        [attr.aria-labelledby]="headingId"
        style="padding: 48px 24px; max-width: 800px; margin: 0 auto;"
      >
        @if (heading) {
          <h2
            [id]="headingId"
            style="
          color: var(--ps-ink, #f4f4ff);
          font-size: clamp(1.5rem, 4vw, 2.2rem);
          font-weight: 800;
          text-align: center;
          margin: 0 0 48px;
        "
          >
            {{ heading }}
          </h2>
        }
        @for (cat of categories; track cat) {
          <div style="margin-bottom: 40px;">
            <h3
              style="
            color: var(--ps-accent, #00e5ff);
            font-size: 0.8rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: .1em;
            margin: 0 0 20px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(0,229,255,0.2);
          "
            >
              {{ cat.title }}
            </h3>
            <ul
              role="list"
              style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:16px;"
            >
              @for (item of cat.items; track item) {
                <li
                  style="
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 12px;
            "
                >
                  <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      <span
                        style="color:var(--ps-ink,#f4f4ff);font-size:0.95rem;font-weight:700;"
                        >{{ item.name }}</span
                      >
                      @if (item.badge) {
                        <span
                          style="
                    background: rgba(0,229,255,0.12);
                    border: 1px solid rgba(0,229,255,0.25);
                    color: var(--ps-accent,#00e5ff);
                    font-size: 0.65rem;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: .05em;
                    padding: 2px 7px;
                    border-radius: 99px;
                  "
                          >{{ item.badge }}</span
                        >
                      }
                      @for (d of item.dietary; track d) {
                        <span
                          style="
                    background: rgba(77,255,181,0.1);
                    color: var(--ps-success, #4dffb5);
                    font-size: 0.65rem;
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 99px;
                  "
                          [attr.aria-label]="d"
                          >{{ d }}</span
                        >
                      }
                    </div>
                    @if (item.description) {
                      <p
                        style="color:rgba(244,244,255,0.6);font-size:0.83rem;line-height:1.5;margin:4px 0 0;"
                      >
                        {{ item.description }}
                      </p>
                    }
                  </div>
                  @if (item.price) {
                    <span
                      style="
                color: var(--ps-ink,#f4f4ff);
                font-size: 0.95rem;
                font-weight: 700;
                white-space: nowrap;
                font-variant-numeric: tabular-nums;
              "
                      aria-label="{{ item.price | currency }} dollars"
                      >{{ item.price | currency }}</span
                    >
                  }
                </li>
              }
            </ul>
          </div>
        }
      </section>
    }
  `,
})
export class MenuBoardComponent {
  @Input() heading = 'Our Menu';
  @Input() headingId = 'sk-menu-heading';
  // No fabricated defaults — a kit menu board must NEVER ship invented dishes/prices
  // (Grilled Salmon $24 …) to a real restaurant's site; a diner would read a fake menu
  // as fact. Empty by default → the <section> self-hides (). The consumer passes
  // the restaurant's REAL menu. (anti-fabrication mandate)
  @Input() categories: MenuCategory[] = [];
}
