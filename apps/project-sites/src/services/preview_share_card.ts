/**
 * @module services/preview_share_card
 * @description #55 `preview_share_card` — owner-driven viral loop. After a build
 * the owner taps "Share my preview" and gets (1) honest, pre-written share
 * messages, (2) one-tap platform deep-links (SMS / WhatsApp / email / X /
 * Facebook), and (3) OG-card params an edge renderer (workers-og / Satori) turns
 * into a branded 1200×630 card. The shared link IS the ad. Pure + zero-I/O: the
 * caller resolves the preview URL + business name and renders/links the output,
 * so this layer unit-tests with no network. Defensive — never throws.
 *
 * @packageDocumentation
 */

/** Inputs needed to build a shareable preview card. */
export interface ShareCardInput {
  readonly businessName: string;
  /** The live preview URL (`{slug}.projectsites.dev` or a snapshot URL). */
  readonly previewUrl: string;
  /** Optional hero tagline used as the OG subtitle. */
  readonly tagline?: string;
  /** Optional owner first name, used to sign the email. */
  readonly ownerFirstName?: string;
  /** OG card theme; defaults to `'dark'` (platform default). */
  readonly theme?: 'dark' | 'light';
}

/** Pre-written, honest share copy per channel. */
export interface ShareMessages {
  readonly sms: string;
  readonly whatsapp: string;
  readonly email: { readonly subject: string; readonly body: string };
  /** Copy-to-clipboard default. */
  readonly generic: string;
}

/** One-tap platform share deep-links (all params URL-encoded). */
export interface ShareLinks {
  readonly sms: string;
  readonly whatsapp: string;
  readonly email: string;
  readonly x: string;
  readonly facebook: string;
  /** The raw preview URL, for a copy-link button. */
  readonly copy: string;
}

/** Params an edge OG renderer turns into a 1200×630 card. */
export interface OgCardParams {
  readonly title: string;
  readonly subtitle: string;
  /** Display host, e.g. `"vitos.projectsites.dev"`. */
  readonly url: string;
  readonly theme: 'dark' | 'light';
}

/** Full share-card bundle. */
export interface PreviewShareCard {
  readonly messages: ShareMessages;
  readonly links: ShareLinks;
  readonly og: OgCardParams;
}

/** Trim + collapse whitespace; empty/uncoercible → fallback. */
function clean(value: string | undefined, fallback: string): string {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v.length > 0 ? v : fallback;
}

/**
 * Extract the display host from a URL, falling back to the trimmed raw string
 * when it isn't a parseable absolute URL.
 *
 * @param rawUrl - A URL (ideally absolute https).
 * @returns The hostname, or the cleaned raw string when unparseable.
 *
 * @example
 * displayHost('https://vitos.projectsites.dev/?x=1') // → 'vitos.projectsites.dev'
 * displayHost('vitos.projectsites.dev')              // → 'vitos.projectsites.dev'
 */
export function displayHost(rawUrl: string): string {
  const raw = (rawUrl ?? '').trim();
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

/**
 * Build honest, professional share copy for a published preview. No marketing
 * slop — plain "we just launched our new website" framing.
 *
 * @param input - {@link ShareCardInput}.
 * @returns {@link ShareMessages} per channel.
 *
 * @example
 * buildShareMessages({ businessName: "Vito's", previewUrl: 'https://v.example' }).generic
 * // → "Check out the new Vito's website: https://v.example"
 */
export function buildShareMessages(input: ShareCardInput): ShareMessages {
  const name = clean(input.businessName, 'our business');
  const url = clean(input.previewUrl, '');
  const owner = clean(input.ownerFirstName, name);
  const withUrl = (text: string): string => (url ? `${text} ${url}` : text);

  return {
    sms: withUrl(`${name} has a new website — take a look:`),
    whatsapp: withUrl(`We just launched the new ${name} website! Check it out:`),
    email: {
      subject: `${name} has a new website`,
      body: `Hi,\n\nWe just launched our new website${url ? ` — take a look: ${url}` : '.'}\n\n— ${owner}`,
    },
    generic: withUrl(`Check out the new ${name} website:`),
  };
}

/**
 * Build one-tap platform share deep-links from a card input. All text + URLs are
 * URL-encoded; channels that take the URL separately (X) get the message text
 * without the URL appended.
 *
 * @param input - {@link ShareCardInput}.
 * @returns {@link ShareLinks}.
 *
 * @example
 * buildShareLinks({ businessName: 'Vito', previewUrl: 'https://v.example' }).x
 * // → 'https://x.com/intent/post?text=...&url=https%3A%2F%2Fv.example'
 */
export function buildShareLinks(input: ShareCardInput): ShareLinks {
  const url = clean(input.previewUrl, '');
  const msgs = buildShareMessages(input);
  const name = clean(input.businessName, 'our business');
  const enc = encodeURIComponent;
  const textNoUrl = `Check out the new ${name} website:`;

  return {
    sms: `sms:?&body=${enc(msgs.sms)}`,
    whatsapp: `https://wa.me/?text=${enc(msgs.whatsapp)}`,
    email: `mailto:?subject=${enc(msgs.email.subject)}&body=${enc(msgs.email.body)}`,
    x: `https://x.com/intent/post?text=${enc(textNoUrl)}${url ? `&url=${enc(url)}` : ''}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    copy: url,
  };
}

/**
 * Build OG-card params for the edge renderer (workers-og / Satori).
 *
 * @param input - {@link ShareCardInput}.
 * @returns {@link OgCardParams} (title/subtitle/host/theme).
 *
 * @example
 * buildOgCardParams({ businessName: 'Vito', previewUrl: 'https://v.example/x' })
 * // → { title: 'Vito', subtitle: 'Now online', url: 'v.example', theme: 'dark' }
 */
export function buildOgCardParams(input: ShareCardInput): OgCardParams {
  return {
    title: clean(input.businessName, 'Your new website'),
    subtitle: clean(input.tagline, 'Now online'),
    url: displayHost(input.previewUrl),
    theme: input.theme === 'light' ? 'light' : 'dark',
  };
}

/**
 * Build the full preview share-card bundle (messages + links + OG params).
 *
 * @param input - {@link ShareCardInput}.
 * @returns {@link PreviewShareCard}.
 */
export function buildPreviewShareCard(input: ShareCardInput): PreviewShareCard {
  return {
    messages: buildShareMessages(input),
    links: buildShareLinks(input),
    og: buildOgCardParams(input),
  };
}
