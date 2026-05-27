/**
 * HostnamesPanelComponent — inline CRUD for a site's hostnames. Lives
 * inside the SiteDetail header so admins never leave the page to add /
 * verify / promote a custom domain.
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { BehaviorSubject, switchMap, take } from 'rxjs';
import { SitesService, type Hostname } from '@org/data-access';

@Component({
  selector: 'lib-hostnames-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, TagModule],
  template: `
    <section class="hostnames" data-testid="hostnames-panel">
      <header>
        <h3>Hostnames</h3>
      </header>
      <ul *ngIf="hostnames$ | async as items">
        <li *ngFor="let h of items" [attr.data-testid]="'hostname-' + h.id">
          <span class="host">{{ h.hostname }}</span>
          <p-tag
            [value]="h.is_primary ? 'primary' : h.status"
            [severity]="h.is_primary ? 'success' : (h.status === 'verified' ? 'info' : 'warning')"
          ></p-tag>
          <span class="actions">
            <button
              *ngIf="h.status !== 'verified'"
              pButton
              size="small"
              severity="secondary"
              label="Verify"
              (click)="verify(h)"
            ></button>
            <button
              *ngIf="h.status === 'verified' && !h.is_primary"
              pButton
              size="small"
              severity="info"
              label="Set primary"
              (click)="setPrimary(h)"
            ></button>
            <button
              pButton
              size="small"
              severity="danger"
              icon="pi pi-times"
              (click)="remove(h)"
            ></button>
          </span>
        </li>
      </ul>
      <form class="add" (ngSubmit)="add()">
        <input
          pInputText
          type="text"
          [(ngModel)]="newHost"
          name="newHost"
          placeholder="example.com"
          data-testid="hostname-input"
        />
        <button
          pButton
          type="submit"
          label="Add"
          [disabled]="!newHost.trim()"
          data-testid="hostname-add"
        ></button>
      </form>
    </section>
  `,
  styles: [
    `
      .hostnames { border: 1px solid var(--border, #2a2a3a); border-radius: 0.5rem; padding: 1rem; }
      ul { list-style: none; padding: 0; margin: 0.5rem 0; display: flex; flex-direction: column; gap: 0.5rem; }
      li { display: flex; align-items: center; gap: 0.75rem; }
      .host { font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; flex: 1; }
      .actions { display: flex; gap: 0.5rem; }
      .add { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
      .add input { flex: 1; }
    `,
  ],
})
export class HostnamesPanelComponent {
  private readonly sites = inject(SitesService);

  private readonly siteId$ = new BehaviorSubject<string>('');
  @Input({ required: true }) set siteId(v: string) {
    this.siteId$.next(v);
  }
  get siteId(): string {
    return this.siteId$.value;
  }

  protected readonly hostnames$ = this.siteId$.pipe(
    switchMap((id) => this.sites.listHostnames$(id)),
  );

  protected newHost = '';

  protected add(): void {
    const host = this.newHost.trim();
    if (!host) return;
    this.sites
      .addHostname$(this.siteId, host)
      .pipe(take(1))
      .subscribe(() => (this.newHost = ''));
  }

  protected verify(h: Hostname): void {
    this.sites.verifyHostname$(this.siteId, h.id).pipe(take(1)).subscribe();
  }

  protected setPrimary(h: Hostname): void {
    this.sites.setPrimaryHostname$(this.siteId, h.id).pipe(take(1)).subscribe();
  }

  protected remove(h: Hostname): void {
    this.sites.removeHostname$(this.siteId, h.id).pipe(take(1)).subscribe();
  }
}
