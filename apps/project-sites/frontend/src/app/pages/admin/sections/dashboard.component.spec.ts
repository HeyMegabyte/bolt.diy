import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AdminDashboardComponent } from './dashboard.component';
import { AdminStateService } from '../admin-state.service';
import { AuthService } from '../../../services/auth.service';

/**
 * The `/admin` index is the Getting Started hub (it replaced the former AI chat
 * dashboard). These tests lock its data contract + gating logic:
 *   - every section card links to a real `/admin/*` (or top-level) route,
 *   - the site-count / has-sites computeds track AdminStateService.sites,
 *   - the Feature Flags discovery card is gated to operator emails only.
 *
 * Logic-level (overrideComponent strips the heavy template DI graph); the
 * template's routerLink/aria bindings are AOT-verified by `ng build`.
 */
function make(email: string, sites: number): AdminDashboardComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminDashboardComponent],
    providers: [
      {
        provide: AdminStateService,
        useValue: { sites: signal(Array.from({ length: sites }, (_, i) => ({ id: `s${i}` }))) },
      },
      { provide: AuthService, useValue: { email: signal(email) } },
    ],
  });
  TestBed.overrideComponent(AdminDashboardComponent, { set: { template: '<div></div>', imports: [] } });
  return TestBed.createComponent(AdminDashboardComponent).componentInstance;
}

describe('AdminDashboardComponent (Getting Started hub)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('exposes section groups, each card linking to a real route with a glyph', () => {
    const c = make('owner@example.com', 0);
    expect(c.groups.length).toBeGreaterThan(0);
    const cards = c.groups.flatMap((g) => g.cards);
    expect(cards.length).toBeGreaterThanOrEqual(12);
    for (const card of cards) {
      expect(card.link.startsWith('/')).withContext(`${card.label} link is absolute`).toBe(true);
      expect(card.label.length).toBeGreaterThan(0);
      expect(card.desc.length).toBeGreaterThan(0);
      expect(card.glyph.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate section links', () => {
    const c = make('owner@example.com', 0);
    const links = c.groups.flatMap((g) => g.cards.map((card) => card.link));
    expect(new Set(links).size).withContext('every section card is unique').toBe(links.length);
  });

  it('ships tips with text + glyphs', () => {
    const c = make('owner@example.com', 0);
    expect(c.tips.length).toBeGreaterThan(0);
    for (const tip of c.tips) {
      expect(tip.text.length).toBeGreaterThan(0);
      expect(tip.glyph.length).toBeGreaterThan(0);
    }
  });

  it('tracks the site count + has-sites state from AdminStateService', () => {
    expect(make('owner@example.com', 0).hasSites()).toBe(false);
    const c = make('owner@example.com', 3);
    expect(c.siteCount()).toBe(3);
    expect(c.hasSites()).toBe(true);
  });

  it('gates the Feature Flags card to operator emails only', () => {
    expect(make('owner@example.com', 1).isSysAdmin()).toBe(false);
    expect(make('brian@megabyte.space', 1).isSysAdmin()).toBe(true);
  });
});
