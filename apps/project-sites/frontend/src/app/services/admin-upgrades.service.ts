/**
 * AdminUpgradesService — central state for the 30 admin upgrades.
 *
 * Hosts: route progress, recently-viewed, recent actions, presence, env,
 * notification queue, what's-new, share-link. All signal-driven so
 * downstream components re-render automatically.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { Router, NavigationStart, NavigationEnd, NavigationCancel, NavigationError, RouteConfigLoadStart, RouteConfigLoadEnd } from '@angular/router';

export interface RecentlyViewed {
  id: string;
  label: string;
  href: string;
  thumb_url?: string;
  visited_at: string;
}

export interface RecentAction {
  id: string;
  label: string;
  href?: string;
  payload?: Record<string, unknown>;
  ts: string;
}

export interface AdminNotification {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body?: string;
  href?: string;
  ts: string;
  read: boolean;
}

export interface PresenceUser {
  id: string;
  name: string;
  email?: string;
  color: string;
  emoji?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminUpgradesService {
  private readonly router = inject(Router);

  // #3 route progress bar state — 0..100, -1 = idle
  readonly routeProgress = signal<number>(-1);
  // #2 skeleton state — current route's destination shape
  readonly nextRouteId = signal<string | null>(null);
  // #14 recently-viewed
  readonly recentlyViewed = signal<RecentlyViewed[]>([]);
  // #6 recent actions
  readonly recentActions = signal<RecentAction[]>([]);
  // #10 env
  readonly env = signal<'production' | 'staging' | 'local'>('production');
  // #12 notification queue
  readonly notifications = signal<AdminNotification[]>([]);
  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);
  // #28 presence (other users on this page)
  readonly presence = signal<PresenceUser[]>([]);

  constructor() {
    this.wireRouterProgress();
    this.loadRecentlyViewedFromLocalStorage();
    this.loadEnvFromHost();
    this.seedNotifications();
    this.seedPresence();
  }

  private wireRouterProgress(): void {
    let ticker: number | null = null;
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart || event instanceof RouteConfigLoadStart) {
        this.routeProgress.set(8);
        this.nextRouteId.set((event as NavigationStart).url ?? null);
        // Animate to 80% while loading
        if (ticker !== null) clearInterval(ticker);
        ticker = window.setInterval(() => {
          const cur = this.routeProgress();
          if (cur < 80) this.routeProgress.set(Math.min(80, cur + Math.random() * 12));
        }, 120);
      } else if (event instanceof RouteConfigLoadEnd) {
        this.routeProgress.set(85);
      } else if (event instanceof NavigationEnd) {
        if (ticker !== null) clearInterval(ticker);
        ticker = null;
        this.routeProgress.set(100);
        window.setTimeout(() => this.routeProgress.set(-1), 250);
        this.nextRouteId.set(null);
      } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
        if (ticker !== null) clearInterval(ticker);
        ticker = null;
        this.routeProgress.set(-1);
        this.nextRouteId.set(null);
      }
    });
  }

  private loadRecentlyViewedFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem('ps:recently-viewed');
      if (raw) this.recentlyViewed.set(JSON.parse(raw));
    } catch {
      // ignore — private mode / quota
    }
  }

  trackRecentlyViewed(item: Omit<RecentlyViewed, 'visited_at'>): void {
    const next: RecentlyViewed = { ...item, visited_at: new Date().toISOString() };
    this.recentlyViewed.update((list) => [next, ...list.filter((x) => x.id !== item.id)].slice(0, 8));
    try {
      localStorage.setItem('ps:recently-viewed', JSON.stringify(this.recentlyViewed()));
    } catch {
      // ignore
    }
  }

  trackAction(action: Omit<RecentAction, 'id' | 'ts'>): void {
    const next: RecentAction = { ...action, id: crypto.randomUUID(), ts: new Date().toISOString() };
    this.recentActions.update((list) => [next, ...list].slice(0, 20));
  }

  private loadEnvFromHost(): void {
    const host = typeof location !== 'undefined' ? location.host : 'projectsites.dev';
    this.env.set(host.startsWith('localhost') ? 'local' : host.includes('staging') ? 'staging' : 'production');
  }

  private seedNotifications(): void {
    this.notifications.set([
      { id: 'n1', level: 'success', title: 'Site published', body: 'bayonne-bakery is live', ts: new Date(Date.now() - 12_000).toISOString(), read: false, href: '/admin/sites' },
      { id: 'n2', level: 'info', title: 'New site features available', body: 'Open Features to turn on capabilities for your site', ts: new Date(Date.now() - 60_000).toISOString(), read: false, href: '/admin/site-features' },
      { id: 'n3', level: 'warning', title: 'CWV gate triggered', body: 'LCP 2.7s on /pricing', ts: new Date(Date.now() - 180_000).toISOString(), read: false, href: '/admin/sites' },
    ]);
  }

  markNotificationRead(id: string): void {
    this.notifications.update((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }

  markAllNotificationsRead(): void {
    this.notifications.update((list) => list.map((n) => ({ ...n, read: true })));
  }

  private seedPresence(): void {
    // Mock — real impl uses Durable Object WebSocket presence
    const colors = ['#00e5ff', '#7c3aed', '#ff6b9d', '#fbbf24'];
    this.presence.set([
      { id: 'me', name: 'You', color: colors[0], emoji: '👤' },
    ]);
  }

  pushPresence(user: Omit<PresenceUser, 'color'>): void {
    const palette = ['#00e5ff', '#7c3aed', '#ff6b9d', '#fbbf24', '#4ade80', '#f87171'];
    const color = palette[this.presence().length % palette.length];
    this.presence.update((list) => [...list.filter((u) => u.id !== user.id), { ...user, color }]);
  }
}
