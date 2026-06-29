/**
 * @module services/archive_signup
 * @description Pure HTML fragment generators for a public newsletter archive
 * listing and signup embed. Zero-I/O, never throws. XSS-safe: escapes all
 * user-provided text.
 *
 * @packageDocumentation
 */

/** One entry in the newsletter archive listing. */
export interface ArchiveEntry {
  readonly title: string;
  readonly sentAt: string; // ISO date string
  readonly url: string; // archive permalink
  readonly snippet: string; // first ~120 chars
}

/** Configuration for the signup form embed. */
export interface SignupFormConfig {
  readonly listmonkListId?: string;
  readonly placeholder?: string;
  readonly buttonLabel?: string;
  readonly thankYouMessage?: string;
}

/** Default placeholder text for the email input. */
const DEFAULT_PLACEHOLDER = 'Your email';
/** Default button label. */
const DEFAULT_BUTTON_LABEL = 'Subscribe';
/** Default thank-you message shown after submission. */
const DEFAULT_THANK_YOU = 'Thanks! Check your inbox.';

/**
 * Replace HTML-special characters with their entity equivalents so the
 * returned string is safe to embed in any HTML context.
 *
 * @param raw - The unsanitized string.
 * @returns The escaped string with `<`, `>`, `&`, `"`, `'` replaced.
 */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format an ISO date string into a human-readable form (e.g. "Jun 15, 2026").
 * Pure; never throws. Returns the raw string if parsing fails.
 *
 * @param iso - An ISO 8601 date string.
 * @returns A short human-readable date, or the original string on parse failure.
 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Build a public newsletter archive section as an HTML string.
 *
 * @param entries - Ordered list of archive entries.
 * @param baseUrl - Optional base URL to prepend to relative entry URLs.
 * @returns An HTML `<section class="newsletter-archive">` string.
 *
 * @example
 * buildArchiveHtml([
 *   { title: 'Hello World', sentAt: '2026-06-01', url: '/archive/1', snippet: 'First issue' }
 * ]);
 * // → '<section class="newsletter-archive">...'
 */
export function buildArchiveHtml(entries: readonly ArchiveEntry[], baseUrl?: string): string {
  if (!entries || entries.length === 0) {
    return [
      '<section class="newsletter-archive">',
      '  <h2>Newsletter Archive</h2>',
      '  <p class="archive-empty">No past issues yet.</p>',
      '</section>',
    ].join('\n');
  }

  const items = entries
    .map((entry) => {
      const title = escapeHtml(entry.title ?? '');
      const snippet = escapeHtml(entry.snippet ?? '');
      const date = formatDate(entry.sentAt ?? '');
      const href = baseUrl
        ? baseUrl.replace(/\/+$/, '') + '/' + (entry.url ?? '').replace(/^\/+/, '')
        : (entry.url ?? '#');
      const safeHref = escapeHtml(href);

      return [
        '  <li>',
        `    <a href="${safeHref}" class="archive-link">`,
        `      <span class="archive-title">${title}</span>`,
        `      <time class="archive-date" datetime="${escapeHtml(entry.sentAt ?? '')}">${date}</time>`,
        '    </a>',
        `    <p class="archive-snippet">${snippet}</p>`,
        '  </li>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<section class="newsletter-archive">',
    '  <h2>Newsletter Archive</h2>',
    '  <ul class="archive-list">',
    items,
    '  </ul>',
    '</section>',
  ].join('\n');
}

/**
 * Build a newsletter signup embed (form HTML + inline script for AJAX submit).
 * The form POSTs to a configurable endpoint and swaps its content with a
 * thank-you message on success.
 *
 * @param config - Optional overrides for labels, endpoint, and thank-you text.
 * @returns An HTML string containing `<form>` + `<script>`.
 *
 * @example
 * buildSignupEmbed({ buttonLabel: 'Join' });
 * // → '<form class="newsletter-signup" ...>...'
 */
export function buildSignupEmbed(config?: SignupFormConfig): string {
  const placeholder = escapeHtml(config?.placeholder ?? DEFAULT_PLACEHOLDER);
  const buttonLabel = escapeHtml(config?.buttonLabel ?? DEFAULT_BUTTON_LABEL);
  const thankYou = escapeHtml(config?.thankYouMessage ?? DEFAULT_THANK_YOU);

  // A hidden honeypot field to discourage basic spam bots without affecting
  // real users. Named with a generic-looking string that bots tend to fill.
  const honeypotName = 'website_url';

  const form = [
    '<form class="newsletter-signup" data-ps-signup="">',
    `  <input type="email" name="email" placeholder="${placeholder}" required="">`,
    `  <div style="position:absolute;left:-9999px" aria-hidden="true">`,
    `    <label for="${honeypotName}">Leave this empty</label>`,
    `    <input type="text" name="${honeypotName}" id="${honeypotName}" tabindex="-1" autocomplete="off">`,
    '  </div>',
    `  <button type="submit">${buttonLabel}</button>`,
    '</form>',
  ].join('\n');

  // Inline script that intercepts the form submit, sends an AJAX POST to the
  // signup endpoint, and replaces the form with a thank-you message on success.
  const listId = config?.listmonkListId ? `, listId: '${escapeHtml(config.listmonkListId)}'` : '';

  const script = [
    '<script>',
    '(function(){',
    "  var forms=document.querySelectorAll('form.newsletter-signup[data-ps-signup]');",
    '  forms.forEach(function(f){',
    "    f.addEventListener('submit', function(e){",
    '      e.preventDefault();',
    '      var fd=new FormData(f);',
    "      var payload={email:fd.get('email')||''",
    listId,
    '};',
    "      fetch('/api/newsletter/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(r){if(r.ok){f.innerHTML='<p class=\"signup-thanks\">" +
      thankYou +
      "</p>'}else{return r.json().then(function(d){var msg=d&&d.message||'Something went wrong.';var err=document.createElement('p');err.className='signup-error';err.textContent=msg;f.parentNode.insertBefore(err,f.nextSibling)})}}).catch(function(){var err=document.createElement('p');err.className='signup-error';err.textContent='Network error. Please try again.';f.parentNode.insertBefore(err,f.nextSibling)})",
    '    });',
    '  });',
    '})();',
    '</script>',
  ].join('\n');

  return form + '\n' + script;
}
