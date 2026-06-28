/**
 * @module auth/email-templates
 *
 * @description
 * Branded transactional email HTML for Better Auth (#31). Pure, zero-dependency
 * template literals — Workers-compatible, no react-email render step in the hot
 * path (simplicity over a build dep for four small emails). Inline styles only
 * (email clients strip `<style>`/external CSS), dark-first ProjectSites brand
 * (`#060610` bg, `#00E5FF` accent), with a plaintext-safe fallback link.
 */

/** ProjectSites brand palette used inline (email clients require inline styles). */
const BG = '#060610';
const CARD = '#0c0c1e';
const INK = '#f4f4ff';
const MUTED = '#9aa0b4';
const ACCENT = '#00E5FF';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Options for {@link brandedEmail}. Provide a `cta` (button) OR a `code` (OTP), or neither. */
export interface BrandedEmailOptions {
  /** H1 heading, e.g. "Sign in to ProjectSites". */
  readonly heading: string;
  /** One or two sentences of body copy (plain text; escaped). */
  readonly body: string;
  /** Primary call-to-action button. */
  readonly cta?: { readonly label: string; readonly url: string };
  /** One-time code to display prominently (for OTP emails). */
  readonly code?: string;
  /** Footer note, e.g. expiry. Defaults to a generic security line. */
  readonly footnote?: string;
}

/**
 * Render a branded transactional email to an HTML string.
 *
 * @param opts - {@link BrandedEmailOptions}.
 * @returns A complete, inline-styled HTML document safe to pass to the email provider.
 *
 * @example
 * brandedEmail({ heading: 'Sign in', body: 'Tap to sign in.', cta: { label: 'Sign in', url } })
 */
export function brandedEmail(opts: BrandedEmailOptions): string {
  const { heading, body, cta, code, footnote } = opts;
  const safeUrl = cta ? esc(cta.url) : '';
  const button = cta
    ? `<a href="${safeUrl}" style="display:inline-block;background:${ACCENT};color:${BG};font-weight:700;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:16px">${esc(cta.label)}</a>
       <p style="color:${MUTED};font-size:13px;margin:20px 0 0">Or paste this link:<br><a href="${safeUrl}" style="color:${ACCENT};word-break:break-all">${safeUrl}</a></p>`
    : '';
  const codeBlock = code
    ? `<div style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:34px;letter-spacing:10px;font-weight:700;color:${ACCENT};background:${BG};border:1px solid rgba(0,229,255,0.25);border-radius:12px;padding:18px 0;text-align:center;margin:8px 0 4px">${esc(code)}</div>`
    : '';
  const foot = footnote ?? 'If you didn’t request this, you can safely ignore this email.';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;background:${BG};font-family:'Sora',-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${CARD};border:1px solid rgba(0,229,255,0.12);border-radius:22px"><tr><td style="padding:36px 32px">
<div style="font-weight:800;font-size:20px;color:${INK};letter-spacing:-0.4px;margin-bottom:24px">Project<span style="color:${ACCENT}">Sites</span></div>
<h1 style="color:${INK};font-size:24px;line-height:1.25;margin:0 0 12px">${esc(heading)}</h1>
<p style="color:${MUTED};font-size:15px;line-height:1.6;margin:0 0 24px">${esc(body)}</p>
${codeBlock}${button}
<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:28px 0 16px">
<p style="color:${MUTED};font-size:12px;line-height:1.5;margin:0">${esc(foot)}</p>
</td></tr></table>
<p style="color:${MUTED};font-size:11px;margin:20px 0 0">© ProjectSites · projectsites.dev</p>
</td></tr></table></body></html>`;
}
