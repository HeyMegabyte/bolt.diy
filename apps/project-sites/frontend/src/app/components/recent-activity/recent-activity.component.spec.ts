import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { RecentActivityComponent } from './recent-activity.component';
import { ApiService } from '../../services/api.service';

/**
 * Regression for the WCAG 2.1 AA 1.4.3 (Contrast Minimum) defect axe-core caught
 * on /admin (2026-08-27): the recent-activity metadata line (`.ra-meta`) rendered
 * at `rgba(255,255,255,0.45)` → 4.46:1 over the widget panel, just under the 4.5:1
 * floor for normal-size text. Root cause: an undefined `--ps-text-muted` token
 * whose 0.45 fallback rendered. Fixed by defining an AA-safe `--ps-text-muted`
 * (rgba(255,255,255,0.6)) and pointing `.ra-meta` at it.
 *
 * This test reads the REAL computed color of the rendered `.ra-meta` and asserts
 * it clears 4.5:1 over the documented widget-panel background — so lowering the
 * value again (token or inline fallback) fails the build.
 */

type Rgba = [number, number, number, number];

function parseRgb(color: string): Rgba {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`unparseable color: ${color}`);
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

/** Alpha-composite a (possibly translucent) foreground over a solid background. */
function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
    1,
  ];
}

function relLuminance([r, g, b]: Rgba): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe('RecentActivityComponent — .ra-meta contrast (WCAG 1.4.3)', () => {
  const ENTRY = {
    id: '1',
    kind: 'build.completed',
    summary: 'SQL query executed',
    actorName: 'e2e-test-user',
    targetType: null,
    targetName: null,
    siteSlug: null,
    timestamp: new Date().toISOString(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecentActivityComponent],
      providers: [
        {
          provide: ApiService,
          useValue: { get: () => of({ data: [ENTRY], cursor: null, hasMore: false }) },
        },
      ],
    }).compileComponents();
  });

  it('renders the metadata line at ≥4.5:1 over the widget panel', () => {
    const fixture = TestBed.createComponent(RecentActivityComponent);
    // getComputedStyle needs the element connected to the document.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();

    const meta = fixture.nativeElement.querySelector('.ra-meta') as HTMLElement | null;
    expect(meta).withContext('activity entry rendered so .ra-meta exists').toBeTruthy();

    const metaColor = parseRgb(getComputedStyle(meta!).color);
    // Documented panel stack: `.ra` = rgba(255,255,255,0.015) over the admin bg #060610.
    const adminBg: Rgba = [6, 6, 16, 1];
    const panel = composite([255, 255, 255, 0.015], adminBg);
    const metaSolid = composite(metaColor, panel);
    const ratio = contrastRatio(metaSolid, panel);

    document.body.removeChild(fixture.nativeElement);

    expect(ratio)
      .withContext(`.ra-meta contrast ${ratio.toFixed(2)}:1 must clear WCAG AA 4.5:1`)
      .toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * Regression for AL-001 (2026-09-05, found via /admin vision inspection): the
 * dashboard Recent-activity rendered a historical audit row verbatim — "Stripe
 * checkout session created for 'undefined' tier". Current code writes clean
 * messages, but stored rows persist, so `clean()` sanitizes at render: no raw
 * undefined/null ever reaches the user.
 */
describe('RecentActivityComponent — clean() strips stray undefined (AL-001)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecentActivityComponent],
      providers: [
        { provide: ApiService, useValue: { get: () => of({ data: [], cursor: null, hasMore: false }) } },
      ],
    }).compileComponents();
  });

  it("drops a broken \"for 'undefined' <word>\" clause", () => {
    const c = TestBed.createComponent(RecentActivityComponent).componentInstance;
    expect(c.clean("Stripe checkout session created for 'undefined' tier")).toBe(
      'Stripe checkout session created',
    );
  });

  it('never renders a raw undefined/null token', () => {
    const c = TestBed.createComponent(RecentActivityComponent).componentInstance;
    for (const s of ["Plan changed to 'undefined'", 'Build undefined completed', "Domain 'null' added"]) {
      expect(c.clean(s))
        .withContext(`sanitized: "${c.clean(s)}"`)
        .not.toMatch(/\b(undefined|null)\b/);
    }
  });

  it('leaves a clean message untouched', () => {
    const c = TestBed.createComponent(RecentActivityComponent).componentInstance;
    expect(c.clean('Site published')).toBe('Site published');
  });
});

/**
 * CLS: the feed card must RESERVE its height while the fetch is in flight (a
 * height-matched skeleton), so the populated card doesn't shove the section-guide
 * groups below it down when it lands — the dominant /admin dashboard layout shift
 * (measured CLS 0.23). Loaded-non-empty → real card; loaded-empty → nothing.
 */
describe('RecentActivityComponent (loading skeleton reserves height — anti-CLS)', () => {
  const ENTRY2 = { id: 'x', kind: 'site.published', summary: 'Published acme', actorName: null, targetType: null, targetName: null, siteSlug: 'acme', timestamp: '2026-09-06T00:00:00Z' };
  afterEach(() => TestBed.resetTestingModule());

  function withFeed(get: () => unknown) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: { get } }] });
    const fx = TestBed.createComponent(RecentActivityComponent);
    fx.detectChanges();
    return fx;
  }

  it('shows the skeleton (not the real card) while the feed is loading', () => {
    const fx = withFeed(() => new Subject()); // never emits → data stays null → loading
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="recent-activity-skeleton"]')).withContext('skeleton reserves height').not.toBeNull();
    expect(el.querySelector('[data-testid="recent-activity"]')).withContext('real card not shown yet').toBeNull();
    expect(fx.componentInstance.loading()).toBeTrue();
  });

  it('swaps skeleton → real card when the feed loads with entries', () => {
    const fx = withFeed(() => of({ data: [ENTRY2], cursor: null, hasMore: false }));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="recent-activity-skeleton"]')).withContext('skeleton gone').toBeNull();
    expect(el.querySelector('[data-testid="recent-activity"]')).withContext('real card shown').not.toBeNull();
    expect(fx.componentInstance.loading()).toBeFalse();
  });

  it('collapses to nothing (honest-empty) when the feed loads empty', () => {
    const fx = withFeed(() => of({ data: [], cursor: null, hasMore: false }));
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="recent-activity-skeleton"]')).toBeNull();
    expect(el.querySelector('[data-testid="recent-activity"]')).toBeNull();
    expect(fx.componentInstance.loading()).withContext('settled, not loading').toBeFalse();
  });
});
