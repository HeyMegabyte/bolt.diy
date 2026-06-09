/**
 * @module components/storefront-manager
 *
 * Owner UI for the storefront_ecommerce catalog — lists products, adds one
 * (name + price + optional https image), deletes one. Talks to
 * /api/sites/:id/products. Self-contained + graceful (404 = flag off).
 */

import { ChangeDetectionStrategy, Component, type OnInit, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';

interface Product {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  image_url: string | null;
  status: string;
}

@Component({
  selector: 'app-storefront-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sm" aria-label="Product catalog">
      <h3 class="sm-h">Products</h3>
      @if (error(); as e) { <p class="sm-note" role="status">{{ e }}</p> }

      <form class="sm-form" (ngSubmit)="add()">
        <input class="sm-in sm-in--name" name="name" [(ngModel)]="name" [disabled]="busy()" placeholder="Product name" aria-label="Product name" data-testid="sm-name" />
        <input class="sm-in sm-in--price" name="price" type="number" min="0" step="0.01" [(ngModel)]="priceDollars" [disabled]="busy()" placeholder="0.00" aria-label="Price" data-testid="sm-price" />
        <input class="sm-in sm-in--img" name="image" [(ngModel)]="imageUrl" [disabled]="busy()" placeholder="https://image… (optional)" aria-label="Image URL" />
        <button class="sm-add" type="submit" [disabled]="busy() || !canAdd()" data-testid="sm-add">{{ busy() ? 'Saving…' : 'Add' }}</button>
      </form>

      @if (loading()) {
        <p class="sm-note">Loading catalog…</p>
      } @else if (products().length === 0) {
        <p class="sm-note">No products yet — add your first above.</p>
      } @else {
        <ul class="sm-list" data-testid="sm-list">
          @for (p of products(); track p.id) {
            <li class="sm-row">
              @if (p.image_url) { <img class="sm-thumb" [src]="p.image_url" [alt]="p.name" loading="lazy" /> } @else { <span class="sm-thumb sm-thumb--blank" aria-hidden="true"></span> }
              <span class="sm-name">{{ p.name }}</span>
              <span class="sm-price">{{ p.price_cents / 100 | currency: p.currency }}</span>
              <button class="sm-del" type="button" (click)="remove(p)" [disabled]="busy()" [attr.aria-label]="'Delete ' + p.name">✕</button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    .sm { background: color-mix(in oklch, var(--ps-bg, #060610) 55%, transparent); border: 1px solid color-mix(in oklch, var(--ps-accent, #00e5ff) 18%, transparent); border-radius: 16px; padding: 1.1rem 1.25rem; color: var(--ps-ink, #f4f4ff); }
    .sm-h { margin: 0 0 .6rem; font-size: 1.05rem; }
    .sm-note { font-size: .82rem; color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 65%, transparent); margin: .4rem 0; }
    .sm-form { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: .75rem; }
    .sm-in { background: color-mix(in oklch, var(--ps-bg, #060610) 60%, transparent); color: inherit; border: 1px solid color-mix(in oklch, currentColor 20%, transparent); border-radius: 8px; padding: .45rem .6rem; font: inherit; font-size: .82rem; }
    .sm-in:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; }
    .sm-in--name { flex: 2 1 10rem; } .sm-in--price { flex: 0 0 6rem; } .sm-in--img { flex: 3 1 12rem; }
    .sm-add { background: var(--ps-accent, #00e5ff); color: var(--ps-bg, #060610); border: 0; border-radius: 8px; padding: .45rem .9rem; font: inherit; font-weight: 700; font-size: .82rem; cursor: pointer; transition: filter .333s ease; }
    .sm-add:hover:not(:disabled) { filter: brightness(1.08); } .sm-add:disabled { opacity: .5; cursor: not-allowed; }
    .sm-add:focus-visible { outline: 2px solid var(--ps-ink, #f4f4ff); outline-offset: 2px; }
    .sm-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .4rem; }
    .sm-row { display: flex; align-items: center; gap: .65rem; padding: .4rem .5rem; border-radius: 10px; background: color-mix(in oklch, var(--ps-bg, #060610) 50%, transparent); }
    .sm-thumb { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; flex: none; }
    .sm-thumb--blank { background: color-mix(in oklch, var(--ps-ink, #f4f4ff) 10%, transparent); }
    .sm-name { flex: 1; min-width: 0; font-size: .88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sm-price { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: .82rem; color: var(--ps-accent, #00e5ff); font-variant-numeric: tabular-nums; }
    .sm-del { background: none; border: 1px solid color-mix(in oklch, currentColor 22%, transparent); color: color-mix(in oklch, var(--ps-ink, #f4f4ff) 60%, transparent); border-radius: 6px; width: 26px; height: 26px; cursor: pointer; flex: none; }
    .sm-del:hover:not(:disabled) { border-color: #f87171; color: #f87171; }
    .sm-del:focus-visible { outline: 2px solid var(--ps-accent, #00e5ff); outline-offset: 1px; }
  `],
})
export class StorefrontManagerComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly siteId = input.required<string>();

  readonly products = signal<Product[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  name = '';
  priceDollars: number | null = null;
  imageUrl = '';

  canAdd(): boolean {
    return this.name.trim().length > 0 && this.priceDollars != null && this.priceDollars >= 0;
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.api.get<{ products: Product[] }>(`/sites/${encodeURIComponent(this.siteId())}/products`, undefined, { silent: true }));
      this.products.set(res?.products ?? []);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 404) this.error.set('The store isn’t enabled for this site yet.');
    } finally {
      this.loading.set(false);
    }
  }

  async add(): Promise<void> {
    if (this.busy() || !this.canAdd()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const body: Record<string, unknown> = { name: this.name.trim(), price_cents: Math.round((this.priceDollars ?? 0) * 100) };
      if (this.imageUrl.trim()) body['image_url'] = this.imageUrl.trim();
      await firstValueFrom(this.api.post(`/sites/${encodeURIComponent(this.siteId())}/products`, body, { silent: true }));
      this.name = ''; this.priceDollars = null; this.imageUrl = '';
      await this.reload();
    } catch {
      this.error.set('Couldn’t add the product (check the fields — image must be https).');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(p: Product): Promise<void> {
    if (this.busy()) return;
    const before = this.products();
    this.products.update((list) => list.filter((x) => x.id !== p.id));
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.delete(`/sites/${encodeURIComponent(this.siteId())}/products/${encodeURIComponent(p.id)}`, { silent: true }));
    } catch {
      this.products.set(before);
      this.error.set('Couldn’t delete the product.');
    } finally {
      this.busy.set(false);
    }
  }
}
