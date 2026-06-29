import {
  buildShareMessages,
  buildShareLinks,
  buildOgCardParams,
  buildPreviewShareCard,
  displayHost,
  type ShareCardInput,
} from '../services/preview_share_card.js';

const base: ShareCardInput = {
  businessName: "Vito's Mens Salon",
  previewUrl: 'https://vitos.projectsites.dev/',
  tagline: 'Classic cuts, modern style',
  ownerFirstName: 'Vito',
};

describe('displayHost (#55 preview_share_card)', () => {
  it('extracts the host from an absolute URL', () => {
    expect(displayHost('https://vitos.projectsites.dev/?x=1')).toBe('vitos.projectsites.dev');
  });

  it('falls back to a cleaned raw string when not parseable', () => {
    expect(displayHost('vitos.projectsites.dev/path')).toBe('vitos.projectsites.dev');
  });
});

describe('buildShareMessages (#55)', () => {
  it('writes honest copy with the URL appended', () => {
    const m = buildShareMessages(base);
    expect(m.generic).toBe(
      "Check out the new Vito's Mens Salon website: https://vitos.projectsites.dev/",
    );
    expect(m.sms).toContain('https://vitos.projectsites.dev/');
    expect(m.email.subject).toBe("Vito's Mens Salon has a new website");
    expect(m.email.body).toContain('— Vito');
  });

  it('signs the email with the business name when no owner given', () => {
    const m = buildShareMessages({ ...base, ownerFirstName: undefined });
    expect(m.email.body.trim().endsWith("— Vito's Mens Salon")).toBe(true);
  });

  it('contains no marketing slop words', () => {
    const m = buildShareMessages(base);
    const all =
      `${m.sms} ${m.whatsapp} ${m.generic} ${m.email.subject} ${m.email.body}`.toLowerCase();
    for (const slop of ['revolutionize', 'cutting-edge', 'world-class', 'limitless', 'leverage']) {
      expect(all).not.toContain(slop);
    }
  });

  it('degrades gracefully when the URL is empty', () => {
    const m = buildShareMessages({ businessName: 'Acme', previewUrl: '' });
    expect(m.generic).toBe('Check out the new Acme website:');
    expect(m.email.body).toContain('We just launched our new website.');
  });
});

describe('buildShareLinks (#55)', () => {
  it('encodes the message into each platform deep-link', () => {
    const l = buildShareLinks(base);
    expect(l.sms.startsWith('sms:?&body=')).toBe(true);
    expect(l.whatsapp.startsWith('https://wa.me/?text=')).toBe(true);
    expect(l.email.startsWith('mailto:?subject=')).toBe(true);
    expect(l.x).toContain('https://x.com/intent/post?text=');
    expect(l.x).toContain('&url=https%3A%2F%2Fvitos.projectsites.dev%2F');
    expect(l.facebook).toBe(
      'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fvitos.projectsites.dev%2F',
    );
    expect(l.copy).toBe('https://vitos.projectsites.dev/');
  });

  it('omits the &url param for X when URL is empty', () => {
    const l = buildShareLinks({ businessName: 'Acme', previewUrl: '' });
    expect(l.x).not.toContain('&url=');
  });
});

describe('buildOgCardParams (#55)', () => {
  it('maps title/subtitle/host with default dark theme', () => {
    expect(buildOgCardParams(base)).toEqual({
      title: "Vito's Mens Salon",
      subtitle: 'Classic cuts, modern style',
      url: 'vitos.projectsites.dev',
      theme: 'dark',
    });
  });

  it('defaults subtitle to "Now online" and honors light theme', () => {
    const og = buildOgCardParams({
      businessName: 'Acme',
      previewUrl: 'https://a.example',
      theme: 'light',
    });
    expect(og.subtitle).toBe('Now online');
    expect(og.theme).toBe('light');
  });
});

describe('buildPreviewShareCard (#55 — full bundle)', () => {
  it('returns messages + links + og together', () => {
    const card = buildPreviewShareCard(base);
    expect(card.messages.generic).toContain('Vito');
    expect(card.links.copy).toBe('https://vitos.projectsites.dev/');
    expect(card.og.url).toBe('vitos.projectsites.dev');
  });
});
