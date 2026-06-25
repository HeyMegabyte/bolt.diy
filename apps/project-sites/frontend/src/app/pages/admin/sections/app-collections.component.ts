/**
 * A11 — curated editorial collections for the app marketplace. Hand-picked rows
 * ("Privacy-first analytics", "Self-hosted AI", "Replace your SaaS bill") give
 * the catalog a magazine front-page instead of one flat grid — the #1 way app
 * stores drive discovery. Pure frontend: each collection is a list of catalog
 * ids resolved against APPS_CATALOG (unknown ids are silently dropped).
 */
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { APPS_CATALOG, type CatalogApp } from './apps-catalog.data';

interface CollectionDef {
  readonly slug: string;
  readonly title: string;
  readonly blurb: string;
  readonly appIds: readonly string[];
}

/** Curated collections — order = display order. App ids must exist in the catalog. */
const COLLECTIONS: readonly CollectionDef[] = [
  {
    slug: 'privacy-analytics',
    title: 'Privacy-first analytics',
    blurb: 'Know your traffic without handing visitors to Big Tech.',
    appIds: ['plausible', 'umami', 'matomo'],
  },
  {
    slug: 'self-hosted-ai',
    title: 'Self-hosted AI',
    blurb: 'Run chat, RAG, and image models on infra you control.',
    appIds: ['open-webui', 'librechat', 'lobe-chat', 'anything-llm', 'flowise', 'comfyui'],
  },
  {
    slug: 'replace-your-saas',
    title: 'Replace your SaaS bill',
    blurb: 'Drop-in open-source for the subscriptions draining your card.',
    appIds: ['vaultwarden', 'cal', 'ghost', 'listmonk', 'nocodb', 'nextcloud'],
  },
  {
    slug: 'knowledge-docs',
    title: 'Knowledge & docs',
    blurb: 'A home for your team’s wiki, notes, and handbooks.',
    appIds: ['outline', 'wikijs', 'bookstack', 'memos'],
  },
  {
    slug: 'creator-stack',
    title: 'Creator stack',
    blurb: 'Publish, grow an audience, and own the relationship.',
    appIds: ['ghost', 'listmonk', 'postiz', 'plausible'],
  },
  {
    slug: 'dev-toolbox',
    title: 'Developer toolbox',
    blurb: 'Git, automation, and a browser IDE for your own cloud.',
    appIds: ['gitea', 'forgejo', 'n8n', 'code-server'],
  },
];

interface ResolvedCollection {
  slug: string;
  title: string;
  blurb: string;
  apps: CatalogApp[];
}

/** Resolve each collection's ids to catalog apps; drop unknown ids + empty rows. */
export function resolveCollections(): ResolvedCollection[] {
  const byId = new Map(APPS_CATALOG.map((a) => [a.id, a]));
  return COLLECTIONS.flatMap((col) => {
    const apps = col.appIds.map((id) => byId.get(id)).filter((a): a is CatalogApp => !!a);
    return apps.length ? [{ slug: col.slug, title: col.title, blurb: col.blurb, apps }] : [];
  });
}

@Component({
  selector: 'app-collections',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="cols" data-testid="app-collections">
      @for (col of collections; track col.slug) {
        <section class="col" [attr.data-testid]="'collection-' + col.slug">
          <header class="col-head">
            <h2 class="col-title">{{ col.title }}</h2>
            <p class="col-blurb">{{ col.blurb }}</p>
          </header>
          <ul class="col-row">
            @for (app of col.apps; track app.id) {
              <li>
                <a
                  class="col-card"
                  [routerLink]="['/admin/apps', app.id]"
                  [attr.data-testid]="'collection-card-' + app.id">
                  <span class="col-glyph" aria-hidden="true">{{ app.glyph }}</span>
                  <span class="col-meta">
                    <span class="col-name">{{ app.name }}</span>
                    <span class="col-tag">{{ app.tagline }}</span>
                  </span>
                </a>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .cols {
        display: flex;
        flex-direction: column;
        gap: 1.4rem;
        margin-bottom: 1.5rem;
      }
      .col-title {
        font-size: 1rem;
        font-weight: 800;
        color: #fff;
        margin: 0;
      }
      .col-blurb {
        font-size: 0.76rem;
        color: var(--text-secondary, #9aa);
        margin: 0.1rem 0 0.6rem;
      }
      .col-row {
        list-style: none;
        margin: 0;
        padding: 0 0 0.3rem;
        display: flex;
        gap: 0.6rem;
        overflow-x: auto;
        scroll-snap-type: x proximity;
      }
      .col-row > li {
        scroll-snap-align: start;
        flex: 0 0 auto;
      }
      .col-card {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        width: 220px;
        padding: 0.6rem 0.7rem;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        background: rgba(255, 255, 255, 0.02);
        text-decoration: none;
        transition:
          border-color 0.15s,
          transform 0.15s;
      }
      .col-card:hover {
        border-color: color-mix(in oklch, var(--ps-accent, #00e5ff) 45%, transparent);
        transform: translateY(-2px);
      }
      .col-glyph {
        font-size: 1.3rem;
        line-height: 1;
      }
      .col-meta {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .col-name {
        font-size: 0.84rem;
        font-weight: 700;
        color: #fff;
      }
      .col-tag {
        font-size: 0.7rem;
        color: var(--text-secondary, #9aa);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (prefers-reduced-motion: reduce) {
        .col-card {
          transition: none;
        }
      }
    `,
  ],
})
export class AppCollectionsComponent {
  readonly collections = resolveCollections();
}
