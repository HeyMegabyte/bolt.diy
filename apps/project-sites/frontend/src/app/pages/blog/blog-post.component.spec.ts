import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BlogPostComponent } from './blog-post.component';
import { MetaService } from '../../services/meta.service';

/**
 * Regression guard: navigating to /blog/:slug must stamp the LOADED POST's
 * title + description into the document head — NOT leave the generic homepage
 * meta. The historical bug: the component injected BlogPosting JSON-LD but never
 * called MetaService, and MetaService's router-driven handler fell back to the
 * homepage PAGE_META for the unmapped `blog/<slug>` path, so every post rendered
 * with the "AI Website Builder, Live in 4 Minutes" title/og:title after hydration.
 */
function mountForSlug(slug: string): { setMeta: jasmine.Spy } {
  TestBed.configureTestingModule({
    imports: [BlogPostComponent],
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => slug } } } },
    ],
  });
  const meta = TestBed.inject(MetaService);
  const setMeta = spyOn(meta, 'setMeta').and.callThrough();
  const fixture = TestBed.createComponent(BlogPostComponent);
  fixture.detectChanges(); // triggers ngOnInit
  return { setMeta };
}

describe('BlogPostComponent (per-post SEO/social meta)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('drives MetaService.setMeta from the loaded post (title + description + canonical)', () => {
    const { setMeta } = mountForSlug('how-ai-is-changing-web-design-for-small-businesses');
    expect(setMeta).toHaveBeenCalled();
    const opts = setMeta.calls.mostRecent().args[0] as {
      title?: string;
      description?: string;
      canonical?: string;
    };
    expect(opts.title).toContain('How AI Is Changing Web Design');
    expect(opts.title).not.toContain('AI Website Builder, Live in 4 Minutes'); // not the homepage default
    expect(opts.description).toContain('AI website builders cut costs');
    expect(opts.canonical).toBe(
      'https://projectsites.dev/blog/how-ai-is-changing-web-design-for-small-businesses',
    );
  });

  it('sets a not-found title (never the homepage default) for an unknown slug', () => {
    const { setMeta } = mountForSlug('this-post-does-not-exist');
    expect(setMeta).toHaveBeenCalled();
    const opts = setMeta.calls.mostRecent().args[0] as { title?: string };
    expect(opts.title?.toLowerCase()).toContain('not found');
  });
});
