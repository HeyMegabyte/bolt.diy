import { TestBed } from '@angular/core/testing';
import { BestPostsComponent, type BestPost } from './best-posts.component';

function setup(posts: BestPost[]) {
  TestBed.configureTestingModule({ imports: [BestPostsComponent] });
  const fixture = TestBed.createComponent(BestPostsComponent);
  fixture.componentRef.setInput('posts', posts);
  fixture.detectChanges();
  return fixture;
}

const POSTS: BestPost[] = [
  { post_id: 'a', publish_id: 'pa', platform: 'instagram', external_url: 'https://insta/a', content_preview: 'Big news today', impressions: 5000, engagement: 320 },
  { post_id: 'b', publish_id: 'pb', platform: 'facebook', external_url: null, content_preview: 'A quieter one', impressions: 800, engagement: 40 },
];

describe('BestPostsComponent (social top posts — data already on the wire)', () => {
  it('renders one card per post, highest engagement first', () => {
    const el = setup(POSTS).nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="best-posts"]')).toBeTruthy();
    const cards = el.querySelectorAll('[data-testid="best-post-card"]');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('Big news today');
    expect(cards[0].textContent).toContain('320'); // engagement
    expect(cards[0].textContent).toContain('5,000'); // impressions, number pipe
  });

  it('renders a View link only when external_url is present', () => {
    const el = setup(POSTS).nativeElement as HTMLElement;
    const links = el.querySelectorAll('a[data-testid="best-post-link"]');
    expect(links.length).toBe(1); // only post a has a url
    expect(links[0].getAttribute('href')).toBe('https://insta/a');
    expect(links[0].getAttribute('rel')).toContain('noopener');
  });

  it('renders nothing when there are no posts', () => {
    const el = setup([]).nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="best-posts"]')).toBeNull();
  });
});
