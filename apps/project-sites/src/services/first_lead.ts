/**
 * @module services/first_lead
 * @description #64 `first_lead_celebration` — the single highest-retention moment
 * in the lifecycle: when the FIRST conversion (call / email / directions / form,
 * off the AN18 `conversion` events) lands for a site, email the owner
 * "🎉 You just got your first lead from your website!" with the conversion type
 * and the section it came from. Pure + zero-I/O: the caller detects "is this the
 * first conversion for this site?" (a count query) and sends via SES; this layer
 * is the deterministic label + email-composition brain, so it unit-tests with no
 * network. Honest, professional copy — no marketing slop. Never throws.
 *
 * @packageDocumentation
 */

/** Raw AN18 conversion kinds emitted by the site tracker, plus form submits. */
export type ConversionKind = 'call' | 'email' | 'directions' | 'form' | string;

/** Inputs to compose the first-lead celebration email. */
export interface FirstLeadInput {
  readonly businessName: string;
  /** The AN18 `conversion.kind` (or `'form'` for a form submission). */
  readonly conversionKind: ConversionKind;
  /** The `data-ps-section` slug the conversion came from, if known. */
  readonly section?: string | null;
  /** Owner first name, used to greet; falls back to a neutral greeting. */
  readonly ownerName?: string;
  /** Deep-link to the owner's analytics dashboard. */
  readonly dashboardUrl: string;
}

/** Composed email (plain + HTML), ready for the SES send path. */
export interface FirstLeadEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * Human label for a conversion kind, e.g. `'call'` → `"phone call"`.
 *
 * @param kind - The AN18 conversion kind.
 * @returns A readable label; unknown kinds → `"website lead"`.
 *
 * @example
 * conversionKindLabel('directions') // → 'directions request'
 */
export function conversionKindLabel(kind: ConversionKind): string {
  switch (kind) {
    case 'call':
      return 'phone call';
    case 'email':
      return 'email';
    case 'directions':
      return 'directions request';
    case 'form':
      return 'contact-form submission';
    default:
      return 'website lead';
  }
}

/**
 * Humanize a `data-ps-section` slug, e.g. `"contact_form"` → `"Contact Form"`.
 * Returns null for an empty/whitespace slug.
 */
export function sectionLabel(section: string | null | undefined): string | null {
  const s = (section ?? '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Escape the few HTML-significant chars for safe interpolation into the body. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Compose the first-lead celebration email (subject + text + HTML).
 * Pure + defensive — missing fields degrade to neutral phrasing, never throws.
 *
 * @param input - {@link FirstLeadInput}.
 * @returns {@link FirstLeadEmail}.
 *
 * @example
 * buildFirstLeadEmail({ businessName: "Vito's", conversionKind: 'call',
 *   section: 'hero', dashboardUrl: 'https://app/x' }).subject
 * // → '🎉 You just got your first lead from your website!'
 */
export function buildFirstLeadEmail(input: FirstLeadInput): FirstLeadEmail {
  const name = (input.businessName ?? '').trim() || 'your business';
  const label = conversionKindLabel(input.conversionKind);
  const section = sectionLabel(input.section);
  const greeting = input.ownerName?.trim() ? `Hi ${input.ownerName.trim()},` : 'Hi,';
  const url = (input.dashboardUrl ?? '').trim();
  const via = section ? ` from your ${section} section` : '';

  const subject = '🎉 You just got your first lead from your website!';

  const text =
    `${greeting}\n\n` +
    `Great news — someone just made a ${label}${via} on your new ${name} website. ` +
    `This is the first lead your site has brought in.\n\n` +
    `That is exactly what it is there to do: turn visitors into real customers. ` +
    `We will keep tracking every call, email, and directions request for you.\n\n` +
    (url ? `See the details in your dashboard: ${url}\n\n` : '') +
    `— The ProjectSites team`;

  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#0a0a1a">` +
    `<p style="font-size:18px">${esc(greeting)}</p>` +
    `<p style="font-size:22px;font-weight:700">🎉 Your first lead just arrived</p>` +
    `<p>Someone just made a <strong>${esc(label)}</strong>${
      section ? ` from your <strong>${esc(section)}</strong> section` : ''
    } on your new <strong>${esc(name)}</strong> website. This is the first lead your site has brought in.</p>` +
    `<p>That is exactly what it is there to do — turn visitors into real customers. ` +
    `We will keep tracking every call, email, and directions request for you.</p>` +
    (url
      ? `<p><a href="${esc(url)}" style="display:inline-block;background:#64ffda;color:#0a0a1a;` +
        `padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">View your analytics</a></p>`
      : '') +
    `<p style="color:#667">— The ProjectSites team</p>` +
    `</div>`;

  return { subject, text, html };
}
