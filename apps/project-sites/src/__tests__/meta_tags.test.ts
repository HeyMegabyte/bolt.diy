/**
 * @module meta_tags.test
 * @description Tests for meta tag presence and correctness across all pages,
 * including static HTML pages, SSR-injected meta tags, and the marketing homepage.
 *
 * Covers:
 * - Static page meta tags (privacy.html, terms.html, content.html)
 * - SSR dynamic meta tag injection in the catch-all handler
 * - Marketing homepage meta tag completeness
 * - Color scheme consistency (megabyte.space brand colors)
 * - Top bar accent color consistency
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateTopBar } from '../services/site_serving';

const PUBLIC_DIR = path.resolve(__dirname, '../../public');

// ─── Helper ────────────────────────────────────────────────────

function readPublicFile(filename: string): string {
  return fs.readFileSync(path.join(PUBLIC_DIR, filename), 'utf-8');
}

// ─── Static Legal Page Meta Tags ───────────────────────────────

describe('Static Legal Page Meta Tags', () => {
  const pages = [
    {
      file: 'privacy.html',
      title: 'Privacy Policy - Project Sites',
      description: 'Privacy Policy for Project Sites by Megabyte LLC',
      canonical: 'https://sites.megabyte.space/privacy',
      ogType: 'article',
    },
    {
      file: 'terms.html',
      title: 'Terms of Service - Project Sites',
      description: 'Terms of Service for Project Sites by Megabyte LLC',
      canonical: 'https://sites.megabyte.space/terms',
      ogType: 'article',
    },
    {
      file: 'content.html',
      title: 'Content Policy - Project Sites',
      description: 'Content Policy for Project Sites by Megabyte LLC',
      canonical: 'https://sites.megabyte.space/content',
      ogType: 'article',
    },
  ];

  it.each(pages)('$file has correct <title>', ({ file, title }) => {
    const html = readPublicFile(file);
    expect(html).toContain(`<title>${title}</title>`);
  });

  it.each(pages)('$file has meta description', ({ file, description }) => {
    const html = readPublicFile(file);
    expect(html).toMatch(new RegExp(`<meta name="description" content="[^"]*${description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*">`));
  });

  it.each(pages)('$file has canonical URL', ({ file, canonical }) => {
    const html = readPublicFile(file);
    expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
  });

  it.each(pages)('$file has Open Graph tags', ({ file, title, canonical, ogType }) => {
    const html = readPublicFile(file);
    expect(html).toContain(`<meta property="og:site_name" content="Project Sites">`);
    expect(html).toContain(`<meta property="og:type" content="${ogType}">`);
    expect(html).toContain(`<meta property="og:title" content="${title}">`);
    expect(html).toMatch(/<meta property="og:description" content="[^"]+">/)
    expect(html).toContain(`<meta property="og:image" content="https://sites.megabyte.space/icon-512.png">`);
    expect(html).toContain(`<meta property="og:url" content="${canonical}">`);
  });

  it.each(pages)('$file has Twitter Card tags', ({ file, title }) => {
    const html = readPublicFile(file);
    expect(html).toContain(`<meta name="twitter:card" content="summary">`);
    expect(html).toContain(`<meta name="twitter:site" content="@MegabyteLabs">`);
    expect(html).toContain(`<meta name="twitter:creator" content="@MegabyteLabs">`);
    expect(html).toContain(`<meta name="twitter:title" content="${title}">`);
    expect(html).toMatch(/<meta name="twitter:description" content="[^"]+">/)
    expect(html).toContain(`<meta name="twitter:image" content="https://sites.megabyte.space/icon-512.png">`);
  });

  it.each(pages)('$file has favicon links', ({ file }) => {
    const html = readPublicFile(file);
    expect(html).toContain('rel="icon" href="/favicon.ico"');
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/logo-icon.svg"');
  });

  it.each(pages)('$file loads Inter font', ({ file }) => {
    const html = readPublicFile(file);
    expect(html).toContain('fonts.googleapis.com/css2?family=Inter');
    expect(html).toMatch(/font-family:\s*'Inter'/);
  });

  it.each(pages)('$file uses megabyte.space accent color #50a5db', ({ file }) => {
    const html = readPublicFile(file);
    expect(html).toContain('#50a5db');
    expect(html).not.toContain('#64ffda');
    expect(html).not.toContain('#4ade80');
  });
});

// ─── Marketing Homepage Meta Tags ──────────────────────────────

describe('Marketing Homepage Meta Tags', () => {
  let html: string;

  beforeAll(() => {
    html = readPublicFile('index.html');
  });

  it('has correct <title>', () => {
    expect(html).toContain('<title>Project Sites - Your Website, Handled. Finally.</title>');
  });

  it('has meta description', () => {
    expect(html).toContain('<meta name="description" content="AI-powered websites for small businesses');
  });

  it('has meta keywords', () => {
    expect(html).toContain('<meta name="keywords"');
    expect(html).toContain('AI website builder');
  });

  it('has meta author', () => {
    expect(html).toContain('<meta name="author" content="Brian Zalewski">');
  });

  it('has meta robots', () => {
    expect(html).toContain('<meta name="robots" content="index, follow">');
  });

  it('has canonical URL', () => {
    expect(html).toContain('<link rel="canonical" href="https://sites.megabyte.space/">');
  });

  // Open Graph
  it('has og:site_name', () => {
    expect(html).toContain('<meta property="og:site_name" content="Project Sites">');
  });

  it('has og:type', () => {
    expect(html).toContain('<meta property="og:type" content="website">');
  });

  it('has og:title', () => {
    expect(html).toContain('<meta property="og:title" content="Project Sites - Your Website, Handled. Finally.">');
  });

  it('has og:description', () => {
    expect(html).toMatch(/<meta property="og:description" content="[^"]+">/)
  });

  it('has og:image', () => {
    expect(html).toContain('<meta property="og:image" content="https://sites.megabyte.space/icon-512.png">');
  });

  it('has og:url', () => {
    expect(html).toContain('<meta property="og:url" content="https://sites.megabyte.space/">');
  });

  it('has al:web:url', () => {
    expect(html).toContain('<meta property="al:web:url" content="https://sites.megabyte.space/">');
  });

  // Twitter Card
  it('has twitter:card', () => {
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('has twitter:site', () => {
    expect(html).toContain('<meta name="twitter:site" content="@MegabyteLabs">');
  });

  it('has twitter:creator', () => {
    expect(html).toContain('<meta name="twitter:creator" content="@MegabyteLabs">');
  });

  it('has twitter:title', () => {
    expect(html).toContain('<meta name="twitter:title" content="Project Sites - Your Website, Handled. Finally.">');
  });

  it('has twitter:description', () => {
    expect(html).toMatch(/<meta name="twitter:description" content="[^"]+">/)
  });

  it('has twitter:image', () => {
    expect(html).toContain('<meta name="twitter:image" content="https://sites.megabyte.space/icon-512.png">');
  });

  // PWA
  it('has manifest', () => {
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest">');
  });

  it('has mobile-web-app-capable', () => {
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes">');
  });

  it('has apple-mobile-web-app-capable', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
  });

  it('has theme-color', () => {
    expect(html).toContain('<meta name="theme-color" content="#0a0a1a">');
  });

  // Favicons
  it('has favicon.ico', () => {
    expect(html).toContain('rel="icon" href="/favicon.ico"');
  });

  it('has SVG icon', () => {
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/logo-icon.svg"');
  });

  it('has apple-touch-icon', () => {
    expect(html).toContain('rel="apple-touch-icon"');
  });

  // JSON-LD
  it('has WebSite JSON-LD', () => {
    expect(html).toContain('"@type": "WebSite"');
    expect(html).toContain('"name": "Project Sites"');
  });

  it('has SoftwareApplication JSON-LD', () => {
    expect(html).toContain('"@type": ["SoftwareApplication", "WebApplication"]');
  });

  it('has Organization JSON-LD', () => {
    expect(html).toContain('"@type": "Organization"');
    expect(html).toContain('"name": "Megabyte Labs"');
  });

  it('has legal pages JSON-LD', () => {
    expect(html).toContain('"headline": "Privacy Policy"');
    expect(html).toContain('"headline": "Terms of Service"');
    expect(html).toContain('"headline": "Content Policy"');
  });

  // Font
  it('loads Inter font', () => {
    expect(html).toContain('fonts.googleapis.com/css2?family=Inter');
  });

  it('uses Inter as primary font family', () => {
    expect(html).toContain("--font: 'Inter'");
    expect(html).toContain('font-family: var(--font)');
  });

  // Preconnect
  it('has preconnect for Google Fonts', () => {
    expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com"');
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com"');
  });

  // PostHog placeholder
  it('has PostHog tracking script with meta key reader', () => {
    expect(html).toContain('x-posthog-key');
    expect(html).toContain('posthog.init');
  });
});

// ─── Brand Color Consistency ───────────────────────────────────

describe('Brand Color Consistency', () => {
  it('homepage uses #50a5db accent (megabyte.space blue)', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('--accent: #50a5db');
  });

  it('homepage does not use old accent #64ffda', () => {
    const html = readPublicFile('index.html');
    expect(html).not.toContain('#64ffda');
  });

  it('homepage does not use old green accent #4ade80', () => {
    const html = readPublicFile('index.html');
    expect(html).not.toContain('#4ade80');
  });

  it('homepage accent-dim uses rgba(80, 165, 219, ...)', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('rgba(80, 165, 219, 0.12)');
  });

  it('homepage accent-glow uses rgba(80, 165, 219, ...)', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('rgba(80, 165, 219, 0.25)');
  });

  it('homepage keeps dark background #0a0a1a', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('--bg-primary: #0a0a1a');
  });

  it('homepage keeps secondary color #7c3aed', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('--secondary: #7c3aed');
  });

  it('top bar uses #50a5db accent', () => {
    const topBar = generateTopBar('test-slug');
    expect(topBar).toContain('#50a5db');
    expect(topBar).not.toContain('#64ffda');
  });

  it.each(['privacy.html', 'terms.html', 'content.html'])(
    '%s uses #50a5db accent color',
    (file) => {
      const html = readPublicFile(file);
      expect(html).toContain('#50a5db');
      expect(html).not.toContain('#64ffda');
      expect(html).not.toContain('#4ade80');
    },
  );
});

// ─── SSR Meta Tag Injection ────────────────────────────────────

describe('SSR Meta Tag Injection', () => {
  /**
   * Simulates the SSR meta tag injection logic from index.ts catch-all handler.
   * This mirrors the production code so we can test it in isolation.
   */
  function simulateSSR(spaHtml: string, screenPath: string): string {
    const screenName = screenPath.slice(1);
    const SITES_BASE = 'sites.megabyte.space';

    const screenMeta: Record<string, { title: string; description: string; url: string }> = {
      privacy: {
        title: 'Privacy Policy - Project Sites',
        description: 'Privacy Policy for Project Sites by Megabyte LLC. Learn how we collect, use, and protect your personal information.',
        url: `https://${SITES_BASE}/privacy`,
      },
      terms: {
        title: 'Terms of Service - Project Sites',
        description: 'Terms of Service for Project Sites by Megabyte LLC. Please read these terms carefully before using our platform.',
        url: `https://${SITES_BASE}/terms`,
      },
      content: {
        title: 'Content Policy - Project Sites',
        description: 'Content Policy for Project Sites by Megabyte LLC. Guidelines for acceptable content on our AI website generation platform.',
        url: `https://${SITES_BASE}/content`,
      },
      contact: {
        title: 'Contact Us - Project Sites',
        description: 'Get in touch with the Project Sites team at Megabyte LLC. We are here to help with your AI-powered website.',
        url: `https://${SITES_BASE}/contact`,
      },
    };

    // PostHog injection
    let html = spaHtml.replace('</head>', `<meta name="x-posthog-key" content="test-key">\n</head>`);

    // Screen activation
    html = html.replace(
      'id="screen-search" class="screen screen-search active"',
      'id="screen-search" class="screen screen-search"',
    );
    html = html.replace(
      `id="screen-${screenName}" class="screen screen-legal"`,
      `id="screen-${screenName}" class="screen screen-legal active"`,
    );

    const meta = screenMeta[screenName];
    if (meta) {
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);
      html = html.replace(
        /<meta name="description" content="[^"]*">/,
        `<meta name="description" content="${meta.description}">`,
      );
      html = html.replace(
        /<link rel="canonical" href="[^"]*">/,
        `<link rel="canonical" href="${meta.url}">`,
      );
      html = html.replace(
        /<meta property="og:title" content="[^"]*">/,
        `<meta property="og:title" content="${meta.title}">`,
      );
      html = html.replace(
        /<meta property="og:description" content="[^"]*">/,
        `<meta property="og:description" content="${meta.description}">`,
      );
      html = html.replace(
        /<meta property="og:url" content="[^"]*">/,
        `<meta property="og:url" content="${meta.url}">`,
      );
      html = html.replace(
        /<meta property="og:type" content="[^"]*">/,
        `<meta property="og:type" content="article">`,
      );
      html = html.replace(
        /<meta name="twitter:title" content="[^"]*">/,
        `<meta name="twitter:title" content="${meta.title}">`,
      );
      html = html.replace(
        /<meta name="twitter:description" content="[^"]*">/,
        `<meta name="twitter:description" content="${meta.description}">`,
      );
      html = html.replace(
        /<meta property="al:web:url" content="[^"]*">/,
        `<meta property="al:web:url" content="${meta.url}">`,
      );
    }

    return html;
  }

  let spaHtml: string;

  beforeAll(() => {
    spaHtml = readPublicFile('index.html');
  });

  describe('/privacy SSR', () => {
    let result: string;

    beforeAll(() => {
      result = simulateSSR(spaHtml, '/privacy');
    });

    it('replaces <title> with privacy policy title', () => {
      expect(result).toContain('<title>Privacy Policy - Project Sites</title>');
      expect(result).not.toContain('<title>Project Sites - Your Website, Handled. Finally.</title>');
    });

    it('replaces meta description', () => {
      expect(result).toContain('content="Privacy Policy for Project Sites by Megabyte LLC');
    });

    it('replaces canonical URL', () => {
      expect(result).toContain('<link rel="canonical" href="https://sites.megabyte.space/privacy">');
    });

    it('replaces og:title', () => {
      expect(result).toContain('<meta property="og:title" content="Privacy Policy - Project Sites">');
    });

    it('replaces og:description', () => {
      expect(result).toMatch(/<meta property="og:description" content="Privacy Policy for Project Sites/);
    });

    it('replaces og:url', () => {
      expect(result).toContain('<meta property="og:url" content="https://sites.megabyte.space/privacy">');
    });

    it('replaces og:type to article', () => {
      expect(result).toContain('<meta property="og:type" content="article">');
    });

    it('replaces twitter:title', () => {
      expect(result).toContain('<meta name="twitter:title" content="Privacy Policy - Project Sites">');
    });

    it('replaces twitter:description', () => {
      expect(result).toMatch(/<meta name="twitter:description" content="Privacy Policy for Project Sites/);
    });

    it('replaces al:web:url', () => {
      expect(result).toContain('<meta property="al:web:url" content="https://sites.megabyte.space/privacy">');
    });

    it('injects PostHog meta key', () => {
      expect(result).toContain('<meta name="x-posthog-key" content="test-key">');
    });

    it('hides search screen', () => {
      expect(result).toContain('id="screen-search" class="screen screen-search"');
      expect(result).not.toContain('id="screen-search" class="screen screen-search active"');
    });

    it('activates privacy screen', () => {
      expect(result).toContain('id="screen-privacy" class="screen screen-legal active"');
    });

    it('preserves og:image', () => {
      expect(result).toContain('<meta property="og:image" content="https://sites.megabyte.space/icon-512.png">');
    });

    it('preserves twitter:image', () => {
      expect(result).toContain('<meta name="twitter:image" content="https://sites.megabyte.space/icon-512.png">');
    });

    it('preserves og:site_name', () => {
      expect(result).toContain('<meta property="og:site_name" content="Project Sites">');
    });
  });

  describe('/terms SSR', () => {
    let result: string;

    beforeAll(() => {
      result = simulateSSR(spaHtml, '/terms');
    });

    it('replaces <title> with terms title', () => {
      expect(result).toContain('<title>Terms of Service - Project Sites</title>');
    });

    it('replaces og:title', () => {
      expect(result).toContain('<meta property="og:title" content="Terms of Service - Project Sites">');
    });

    it('replaces canonical URL', () => {
      expect(result).toContain('<link rel="canonical" href="https://sites.megabyte.space/terms">');
    });

    it('replaces og:url', () => {
      expect(result).toContain('<meta property="og:url" content="https://sites.megabyte.space/terms">');
    });

    it('replaces twitter:title', () => {
      expect(result).toContain('<meta name="twitter:title" content="Terms of Service - Project Sites">');
    });

    it('sets og:type to article', () => {
      expect(result).toContain('<meta property="og:type" content="article">');
    });
  });

  describe('/content SSR', () => {
    let result: string;

    beforeAll(() => {
      result = simulateSSR(spaHtml, '/content');
    });

    it('replaces <title> with content policy title', () => {
      expect(result).toContain('<title>Content Policy - Project Sites</title>');
    });

    it('replaces og:title', () => {
      expect(result).toContain('<meta property="og:title" content="Content Policy - Project Sites">');
    });

    it('replaces canonical URL', () => {
      expect(result).toContain('<link rel="canonical" href="https://sites.megabyte.space/content">');
    });

    it('replaces og:url', () => {
      expect(result).toContain('<meta property="og:url" content="https://sites.megabyte.space/content">');
    });

    it('replaces meta description', () => {
      expect(result).toContain('content="Content Policy for Project Sites by Megabyte LLC');
    });
  });

  describe('/contact SSR', () => {
    let result: string;

    beforeAll(() => {
      result = simulateSSR(spaHtml, '/contact');
    });

    it('replaces <title> with contact title', () => {
      expect(result).toContain('<title>Contact Us - Project Sites</title>');
    });

    it('replaces og:title', () => {
      expect(result).toContain('<meta property="og:title" content="Contact Us - Project Sites">');
    });

    it('replaces canonical URL', () => {
      expect(result).toContain('<link rel="canonical" href="https://sites.megabyte.space/contact">');
    });

    it('replaces meta description', () => {
      expect(result).toContain('content="Get in touch with the Project Sites team at Megabyte LLC');
    });
  });

  describe('Unknown screens are unmodified', () => {
    it('does not replace meta tags for unknown paths', () => {
      const result = simulateSSR(spaHtml, '/unknown');
      // Title should remain unchanged (SSR meta injection only fires for known screens)
      expect(result).toContain('<title>Project Sites - Your Website, Handled. Finally.</title>');
      expect(result).toContain('<meta property="og:type" content="website">');
    });
  });
});

// ─── Email Template Brand Colors ───────────────────────────────

describe('Email Template Brand Colors', () => {
  it('auth magic link email uses #50a5db accent', () => {
    // Read the auth service to verify color usage
    const authTs = fs.readFileSync(
      path.resolve(__dirname, '../services/auth.ts'),
      'utf-8',
    );
    expect(authTs).toContain('#50a5db');
    expect(authTs).not.toContain('#64ffda');
  });

  it('contact email templates use #50a5db accent', () => {
    const contactTs = fs.readFileSync(
      path.resolve(__dirname, '../services/contact.ts'),
      'utf-8',
    );
    expect(contactTs).toContain('#50a5db');
    expect(contactTs).not.toContain('#64ffda');
  });
});
