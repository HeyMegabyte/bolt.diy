/**
 * `BlogPostComponent` — renders a single blog post fetched from R2.
 *
 * @remarks
 *  - Per `[[copy-writing]]` § GEO/AI search: every post leads with a
 *    40–60 word "quotable answer" block AI search engines (ChatGPT,
 *    Perplexity, Google AI Overviews) cite directly. The block carries
 *    `data-speakable` so a page-level Article schema can target it via
 *    `SpeakableSpecification.cssSelector`.
 *  - RxJS-first per [[rxjs-first-angular]]: post stream is observable;
 *    template reads `toSignal()`.
 *
 * @see [[copy-writing]] § Production-review copy gate (no slop, no TODO)
 */
import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';

export interface BlogPost {
  readonly slug: string;
  readonly title: string;
  readonly dek: string;
  readonly author: string;
  readonly date: string;
  readonly tags: ReadonlyArray<string>;
  readonly hero: string;
  /** 40-60 word AI-search-optimised lead. */
  readonly quotable_answer: string;
  /** Pre-rendered Markdown → HTML (sanitized server-side). */
  readonly body_html: string;
}

@Component({
  selector: 'lib-blog-post',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @if (post(); as p) {
      <article class="ps-post" data-testid="blog-post">
        <header class="ps-post__head">
          <h1>{{ p.title }}</h1>
          <p class="ps-post__dek">{{ p.dek }}</p>
        </header>

        <aside
          class="ps-post__quotable quotable-answer"
          data-speakable
          data-testid="quotable-answer"
          aria-label="Quotable answer"
        >
          <strong class="ps-post__quotable-label">In short</strong>
          <p>{{ p.quotable_answer }}</p>
        </aside>

        <p class="ps-post__byline">
          <span>{{ p.author }}</span>
          <span aria-hidden="true">·</span>
          <time [attr.datetime]="p.date">{{ p.date | date: 'mediumDate' }}</time>
        </p>

        <div class="ps-post__body" [innerHTML]="p.body_html"></div>
      </article>
    } @else {
      <p class="ps-post__loading" data-testid="blog-post-loading">Loading post…</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        color: var(--ps-ink, #f4f4ff);
      }
      .ps-post {
        max-width: 720px;
        padding: 1.6rem;
        margin-inline: auto;
        line-height: 1.6;
      }
      .ps-post__head h1 {
        font-family: var(--ps-font-heading, 'Space Grotesk', sans-serif);
        font-size: var(--ps-text-4xl, 2.25rem);
        line-height: 1.1;
        margin: 0;
        text-wrap: balance;
      }
      .ps-post__dek {
        margin: 0.6rem 0 0;
        font-size: var(--ps-text-lg, 1.1rem);
        color: color-mix(in oklch, currentColor 75%, transparent);
      }
      .ps-post__quotable {
        margin: 1.6rem 0;
        padding: 1.1rem 1.3rem;
        border-radius: var(--ps-radius-lg, 16px);
        background: color-mix(in oklch, var(--ps-accent, #00e5ff) 8%, transparent);
        border-left: 3px solid var(--ps-accent, #00e5ff);
      }
      .ps-post__quotable-label {
        display: block;
        font-family: var(--ps-font-mono, ui-monospace, monospace);
        font-size: 0.7rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ps-ink-accent, var(--ps-accent, #00e5ff));
        margin-bottom: 0.35rem;
      }
      .ps-post__quotable p {
        margin: 0;
        font-size: var(--ps-text-lg, 1.1rem);
        line-height: 1.5;
        text-wrap: pretty;
      }
      .ps-post__byline {
        display: flex;
        gap: 0.5rem;
        color: color-mix(in oklch, currentColor 60%, transparent);
        font-size: 0.85rem;
        margin: 1.2rem 0 1.6rem;
      }
      .ps-post__body :first-child {
        margin-top: 0;
      }
      .ps-post__loading {
        padding: 1.6rem;
        opacity: 0.7;
      }
    `,
  ],
})
export class BlogPostComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly doc = inject(DOCUMENT);

  private readonly post$ = this.route.paramMap.pipe(
    switchMap((params) => {
      const slug = params.get('slug') ?? '';
      if (!slug) return of<BlogPost | null>(null);
      return this.http
        .get<BlogPost>(`/api/blog/${encodeURIComponent(slug)}.json`)
        .pipe(catchError(() => of<BlogPost | null>(null)));
    }),
    map((p) => p),
    takeUntilDestroyed(this.destroyRef),
  );

  readonly post = toSignal(this.post$, { initialValue: null as BlogPost | null });

  /**
   * Article JSON-LD with a `SpeakableSpecification` pointing at every
   * `[data-speakable]` element on the page. Injected into `<head>` as
   * the page-level structured data.
   */
  readonly articleSchema = computed<string | null>(() => {
    const p = this.post();
    if (!p) return null;
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: p.title,
      description: p.dek,
      datePublished: p.date,
      author: { '@type': 'Person', name: p.author },
      image: p.hero,
      keywords: p.tags.join(', '),
      articleBody: p.quotable_answer,
      speakable: {
        '@type': 'SpeakableSpecification',
        cssSelector: ['[data-speakable]'],
      },
    };
    return JSON.stringify(ld);
  });

  constructor() {
    // Mirror the Article+Speakable JSON-LD into the document head when
    // the post resolves. We never inject `null` — empty state stays
    // schema-less rather than emitting a stub.
    this.post$.subscribe(() => {
      if (typeof document === 'undefined') return;
      const schema = this.articleSchema();
      const id = 'blog-post-jsonld';
      let node = this.doc.getElementById(id) as HTMLScriptElement | null;
      if (!schema) {
        node?.remove();
        return;
      }
      if (!node) {
        node = this.doc.createElement('script') as HTMLScriptElement;
        node.id = id;
        node.type = 'application/ld+json';
        this.doc.head.appendChild(node);
      }
      node.textContent = schema;
    });
  }
}
