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
const CARD1 = '#0c0c1e';
const CARD2 = '#0a0a18';
const INK = '#f4f4ff';
const MUTED = '#9aa0b4';
const FAINT = '#5b6484';
const ACCENT = '#00E5FF';
const BLUE = '#50AAE3';
const VIOLET = '#7C3AED';
const HEAD = "'Space Grotesk','Sora',-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const BODY_FONT = "'Sora',-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

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
  /** Optional glowing badge glyph (HTML entity / emoji) shown above the heading. */
  readonly badge?: string;
}

/**
 * Render a branded transactional email to an HTML string — the gorgeous dark
 * ProjectSites shell: #060610 canvas with a cyan glow, a cyan→violet accent
 * bar, an optional glowing badge, and a gradient CTA (Outlook VML fallback).
 *
 * @param opts - {@link BrandedEmailOptions}.
 * @returns A complete, inline-styled HTML document safe to pass to the email provider.
 *
 * @example
 * brandedEmail({ heading: 'Sign in', body: 'Tap to sign in.', cta: { label: 'Sign in', url } })
 */
export function brandedEmail(opts: BrandedEmailOptions): string {
  const { heading, body, cta, code, footnote, badge } = opts;
  const safeUrl = cta ? esc(cta.url) : '';
  const badgeBlock = badge
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 22px"><tr><td align="center" valign="middle" width="64" height="64" style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,${ACCENT},${VIOLET});box-shadow:0 10px 34px rgba(0,229,255,0.34);font-size:27px;line-height:64px;text-align:center;color:${BG}">${badge}</td></tr></table>`
    : '';
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:4px auto 0"><tr><td align="center" style="border-radius:12px;background:linear-gradient(135deg,${ACCENT},${VIOLET});box-shadow:0 12px 30px rgba(124,58,237,0.42)">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl}" style="height:50px;v-text-anchor:middle;width:260px;" arcsize="24%" fillcolor="#00E5FF" stroke="f"><w:anchorlock/><center style="color:#060610;font-family:sans-serif;font-size:16px;font-weight:bold">${esc(cta.label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${safeUrl}" style="display:inline-block;color:${BG};font-weight:700;text-decoration:none;padding:15px 34px;border-radius:12px;font-size:16px;font-family:${HEAD}">${esc(cta.label)}</a><!--<![endif]-->
</td></tr></table>
<p style="color:${MUTED};font-size:13px;margin:20px 0 0;text-align:center">Or paste this link:<br><a href="${safeUrl}" style="color:${ACCENT};word-break:break-all">${safeUrl}</a></p>`
    : '';
  const codeBlock = code
    ? `<div style="font-family:${MONO};font-size:34px;letter-spacing:10px;font-weight:700;color:${ACCENT};background:${BG};border:1px solid rgba(0,229,255,0.25);border-radius:12px;padding:20px 0;text-align:center;margin:8px 0 4px;box-shadow:0 0 30px rgba(0,229,255,0.12)">${esc(code)}</div>`
    : '';
  const foot = footnote ?? 'If you didn’t request this, you can safely ignore this email.';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;background:${BG};font-family:${BODY_FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:radial-gradient(760px 440px at 50% -8%,rgba(0,229,255,0.10),transparent 62%),${BG}"><tr><td align="center" style="padding:44px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:linear-gradient(162deg,${CARD1},${CARD2});border:1px solid rgba(0,229,255,0.14);border-radius:22px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.6)">
<tr><td style="height:4px;line-height:4px;font-size:0;background:linear-gradient(90deg,${ACCENT},${BLUE} 46%,${VIOLET})">&nbsp;</td></tr>
<tr><td style="padding:34px 32px 36px">
<div style="font-family:${HEAD};font-weight:800;font-size:20px;color:${INK};letter-spacing:-0.4px;margin-bottom:24px;text-align:center">Project<span style="color:${ACCENT}">Sites</span></div>
${badgeBlock}
<h1 style="color:${INK};font-family:${HEAD};font-size:25px;line-height:1.25;margin:0 0 12px;text-align:center;letter-spacing:-0.02em">${esc(heading)}</h1>
<p style="color:${MUTED};font-size:15px;line-height:1.65;margin:0 0 24px;text-align:center">${esc(body)}</p>
<div style="text-align:center">${codeBlock}${button}</div>
<hr style="border:none;border-top:1px solid rgba(0,229,255,0.10);margin:28px 0 16px">
<p style="color:${FAINT};font-size:12px;line-height:1.5;margin:0;text-align:center">${esc(foot)}</p>
</td></tr></table>
<p style="color:${FAINT};font-size:11px;margin:20px 0 0">© ProjectSites · <a href="https://projectsites.dev" style="color:${MUTED};text-decoration:none">projectsites.dev</a></p>
</td></tr></table></body></html>`;
}
