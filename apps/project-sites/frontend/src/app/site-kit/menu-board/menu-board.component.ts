import { Component, Input } from '@angular/core';
import { NgFor, NgIf, CurrencyPipe } from '@angular/common';

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
  imports: [NgFor, NgIf, CurrencyPipe],
  template: `
    <section [attr.aria-labelledby]="headingId" style="padding: 48px 24px; max-width: 800px; margin: 0 auto;">
      <h2
        *ngIf="heading"
        [id]="headingId"
        style="
          color: var(--ps-ink, #f4f4ff);
          font-size: clamp(1.5rem, 4vw, 2.2rem);
          font-weight: 800;
          text-align: center;
          margin: 0 0 48px;
        "
      >{{ heading }}</h2>

      <div
        *ngFor="let cat of categories"
        style="margin-bottom: 40px;"
      >
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
        >{{ cat.title }}</h3>
        <ul role="list" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:16px;">
          <li
            *ngFor="let item of cat.items"
            style="
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 12px;
            "
          >
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="color:var(--ps-ink,#f4f4ff);font-size:0.95rem;font-weight:700;">{{ item.name }}</span>
                <span
                  *ngIf="item.badge"
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
                >{{ item.badge }}</span>
                <span
                  *ngFor="let d of item.dietary"
                  style="
                    background: rgba(77,255,181,0.1);
                    color: var(--ps-success, #4dffb5);
                    font-size: 0.65rem;
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 99px;
                  "
                  [attr.aria-label]="d"
                >{{ d }}</span>
              </div>
              <p
                *ngIf="item.description"
                style="color:rgba(244,244,255,0.6);font-size:0.83rem;line-height:1.5;margin:4px 0 0;"
              >{{ item.description }}</p>
            </div>
            <span
              *ngIf="item.price"
              style="
                color: var(--ps-ink,#f4f4ff);
                font-size: 0.95rem;
                font-weight: 700;
                white-space: nowrap;
                font-variant-numeric: tabular-nums;
              "
              aria-label="{{ item.price | currency }} dollars"
            >{{ item.price | currency }}</span>
          </li>
        </ul>
      </div>
    </section>
  `,
})
export class MenuBoardComponent {
  @Input() heading = 'Our Menu';
  @Input() headingId = 'sk-menu-heading';
  @Input() categories: MenuCategory[] = [
    {
      title: 'Starters',
      items: [
        { name: 'Garden Salad', description: 'Mixed greens, cherry tomatoes, cucumber, house vinaigrette.', price: 9, dietary: ['V', 'GF'] },
        { name: 'Soup of the Day', description: 'Ask your server for today\'s selection.', price: 7 },
      ],
    },
    {
      title: 'Mains',
      items: [
        { name: 'Grilled Salmon', description: 'Citrus-herb salmon with roasted vegetables and wild rice.', price: 24, badge: 'Popular', dietary: ['GF'] },
        { name: 'Pasta Primavera', description: 'Seasonal vegetables, olive oil, garlic, parmesan.', price: 18, dietary: ['V'] },
        { name: 'BBQ Ribs', description: 'Full rack slow-smoked, house BBQ sauce, coleslaw, fries.', price: 32, badge: 'Chef\'s Pick' },
      ],
    },
  ];
}
