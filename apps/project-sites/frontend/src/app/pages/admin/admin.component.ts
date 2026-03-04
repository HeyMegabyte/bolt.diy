import { Component, OnInit, OnDestroy, inject, signal, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { interval, takeWhile, switchMap, forkJoin, Subject, debounceTime, distinctUntilChanged, filter } from 'rxjs';
import {
  IonButton, IonSpinner, IonContent,
  ModalController,
} from '@ionic/angular/standalone';
import { ApiService, Site, DomainSummary, SubscriptionInfo } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { DeleteModalComponent } from '../../modals/delete-modal.component';
import { DomainModalComponent } from '../../modals/domain-modal.component';
import { LogsModalComponent } from '../../modals/logs-modal.component';
import { ResetModalComponent } from '../../modals/reset-modal.component';
import { DetailsModalComponent } from '../../modals/details-modal.component';
import { FilesModalComponent } from '../../modals/files-modal.component';
import { DeployModalComponent } from '../../modals/deploy-modal.component';
import { StatusModalComponent } from '../../modals/status-modal.component';
import { CheckoutModalComponent } from '../../modals/checkout-modal.component';

interface SlugEditState {
  siteId: string;
  value: string;
  status: 'idle' | 'checking' | 'available' | 'taken' | 'error';
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, IonButton, IonSpinner, IonContent],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private modalCtrl = inject(ModalController);

  sites = signal<Site[]>([]);
  domainSummary = signal<DomainSummary>({ total: 0, active: 0, pending: 0, failed: 0 });
  subscription = signal<SubscriptionInfo | null>(null);
  loading = signal(true);
  alive = true;

  /** Inline slug editing state */
  slugEdit = signal<SlugEditState | null>(null);
  private slugCheck$ = new Subject<{ slug: string; siteId: string }>();

  /** More menu state */
  moreMenuOpen = signal<string | null>(null);

  /** Status color map */
  private statusColors: Record<string, string> = {
    published: '#00e676',
    building: '#ffab00',
    queued: '#ffab00',
    generating: '#00b8d4',
    uploading: '#00b8d4',
    error: '#ff1744',
    draft: '#607d8b',
    archived: '#455a64',
  };

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/signin']);
      return;
    }
    this.loadData();
    this.startPolling();
    this.setupSlugChecker();
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.slugCheck$.complete();
  }

  private loadData(): void {
    forkJoin({
      sites: this.api.listSites(),
      domains: this.api.getDomainSummary(),
    }).subscribe({
      next: (res) => {
        this.sites.set(res.sites.data || []);
        this.domainSummary.set(res.domains.data || { total: 0, active: 0, pending: 0, failed: 0 });
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Failed to load dashboard data');
      },
    });

    this.api.getSubscription().subscribe({
      next: (res) => this.subscription.set(res.data),
      error: () => { /* subscription check may fail for free users */ },
    });
  }

  private startPolling(): void {
    interval(5000)
      .pipe(
        takeWhile(() => this.alive && this.sites().some((s) =>
          ['building', 'queued', 'generating', 'uploading'].includes(s.status))),
        switchMap(() => this.api.listSites())
      )
      .subscribe({
        next: (res) => this.sites.set(res.data || []),
      });
  }

  private setupSlugChecker(): void {
    this.slugCheck$.pipe(
      debounceTime(400),
      distinctUntilChanged((a, b) => a.slug === b.slug),
      filter((v) => v.slug.length >= 2),
    ).subscribe(({ slug, siteId }) => {
      this.api.checkSlug(slug, siteId).subscribe({
        next: (res) => {
          const current = this.slugEdit();
          if (current && current.siteId === siteId && current.value === slug) {
            this.slugEdit.set({ ...current, status: res.data.available ? 'available' : 'taken' });
          }
        },
        error: () => {
          const current = this.slugEdit();
          if (current && current.siteId === siteId) {
            this.slugEdit.set({ ...current, status: 'error' });
          }
        },
      });
    });
  }

  getStatusColor(status: string): string {
    return this.statusColors[status] || '#94a3b8';
  }

  isActiveStatus(status: string): boolean {
    return ['building', 'queued', 'generating', 'uploading'].includes(status);
  }

  getSiteUrl(site: Site): string {
    return site.primary_hostname
      ? `https://${site.primary_hostname}`
      : `https://${site.slug}.projectsites.dev`;
  }

  getSiteDisplayUrl(site: Site): string {
    return site.primary_hostname || `${site.slug}.projectsites.dev`;
  }

  // ─── Inline slug editing ──────────────────────────────
  startSlugEdit(site: Site): void {
    this.slugEdit.set({ siteId: site.id, value: site.slug, status: 'idle' });
  }

  isEditingSlug(siteId: string): boolean {
    return this.slugEdit()?.siteId === siteId;
  }

  onSlugInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const edit = this.slugEdit();
    if (!edit) return;
    this.slugEdit.set({ ...edit, value: raw, status: raw.length >= 2 ? 'checking' : 'idle' });
    if (raw.length >= 2) {
      this.slugCheck$.next({ slug: raw, siteId: edit.siteId });
    }
  }

  saveSlug(site: Site): void {
    const edit = this.slugEdit();
    if (!edit || edit.status === 'taken' || !edit.value.trim()) return;
    if (edit.value === site.slug) {
      this.slugEdit.set(null);
      return;
    }
    this.api.updateSite(site.id, { slug: edit.value }).subscribe({
      next: (res) => {
        this.sites.update((sites) =>
          sites.map((s) => (s.id === site.id ? { ...s, ...res.data } : s))
        );
        this.slugEdit.set(null);
        this.toast.success('Slug updated');
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Failed to update slug');
      },
    });
  }

  cancelSlugEdit(): void {
    this.slugEdit.set(null);
  }

  getSlugStatusClass(): string {
    const edit = this.slugEdit();
    if (!edit) return '';
    return 'slug-' + edit.status;
  }

  // ─── More menu ──────────────────────────────────────────
  toggleMoreMenu(siteId: string, event: Event): void {
    event.stopPropagation();
    this.moreMenuOpen.set(this.moreMenuOpen() === siteId ? null : siteId);
  }

  @HostListener('document:click')
  closeMoreMenu(): void {
    if (this.moreMenuOpen()) this.moreMenuOpen.set(null);
  }

  // ─── Navigation & actions ─────────────────────────────
  newSite(): void {
    this.router.navigate(['/']);
  }

  visitSite(site: Site): void {
    window.open(this.getSiteUrl(site), '_blank');
  }

  async openDetails(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DetailsModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role === 'updated' && data) {
      this.sites.update((sites) => sites.map((s) => s.id === data.id ? data : s));
    }
  }

  async openDomains(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DomainModalComponent,
      componentProps: { siteId: site.id },
      cssClass: 'app-modal',
    });
    await modal.present();
  }

  async openLogs(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: LogsModalComponent,
      componentProps: { siteId: site.id },
      cssClass: 'app-modal',
    });
    await modal.present();
  }

  async openStatus(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: StatusModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
  }

  async openFiles(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: FilesModalComponent,
      componentProps: { siteId: site.id },
      cssClass: 'app-modal-fullscreen',
    });
    await modal.present();
  }

  async openDeploy(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DeployModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
    const { role } = await modal.onDidDismiss();
    if (role === 'deployed') this.loadData();
  }

  async openReset(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ResetModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role === 'reset' && data) {
      this.sites.update((sites) => sites.map((s) => s.id === data.id ? data : s));
    }
  }

  async openDelete(site: Site): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DeleteModalComponent,
      componentProps: { site },
      cssClass: 'app-modal',
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role === 'deleted' && data) {
      this.sites.update((sites) => sites.filter((s) => s.id !== data));
    }
  }

  async openCheckout(site: Site): Promise<void> {
    const me = await this.api.getMe().toPromise();
    if (!me?.data?.org_id) {
      this.toast.error('Unable to load billing info');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: CheckoutModalComponent,
      componentProps: { site, orgId: me.data.org_id },
      cssClass: 'app-modal',
    });
    await modal.present();
  }

  async openBillingPortal(): Promise<void> {
    this.api.getBillingPortal(window.location.href).subscribe({
      next: (res) => {
        if (res.data.portal_url) {
          window.location.href = res.data.portal_url;
        }
      },
      error: () => this.toast.error('Failed to open billing portal'),
    });
  }

  getSubscriptionLabel(): string {
    const sub = this.subscription();
    if (!sub) return 'Free Plan';
    return sub.plan === 'paid' ? 'Pro Plan' : 'Free Plan';
  }
}
