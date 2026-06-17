/**
 * claimyour.site — build-session notification emails (#1 §2).
 *
 * @remarks
 * Pure content builders for the three claim-build lifecycle emails (build
 * started / finished / failed) plus a dependency-injected sender that never
 * throws. Copy is brand-voiced, short, and slop-free (copy-writing rule); the
 * business name is HTML-escaped so an attacker-controlled lead name can't inject
 * markup into the email body.
 *
 * @example
 * ```ts
 * await sendClaimBuildEmail('finished', lead.email, { businessName, previewUrl },
 *   { send: (m) => sendEmail(env, m) });
 * ```
 */

/** Which lifecycle email to render. */
export type ClaimEmailKind = 'started' | 'finished' | 'failed';

/** Context for rendering — only the fields a given kind needs are used. */
export interface ClaimEmailContext {
  businessName?: string;
  previewUrl?: string;
  createUrl?: string;
  error?: string;
}

/** A rendered email payload. */
export interface ClaimEmail {
  subject: string;
  html: string;
  text: string;
}

/** Escape the five HTML-significant chars. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(href: string, label: string): string {
  return `<p><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;background:#00E5FF;color:#060610;border-radius:8px;text-decoration:none;font-weight:700">${esc(label)}</a></p>`;
}

/**
 * Render a claim-build email (subject + html + text). Pure.
 *
 * @param kind - Which lifecycle email.
 * @param ctx - Render context (businessName, previewUrl, createUrl, error).
 * @returns A {@link ClaimEmail}.
 */
export function buildClaimEmail(kind: ClaimEmailKind, ctx: ClaimEmailContext): ClaimEmail {
  const name = ctx.businessName?.trim() || 'your business';
  const safeName = esc(name);

  if (kind === 'started') {
    const subject = `We're building your website`;
    const line1 = `We're building ${name}'s website right now. It keeps going even if you close this tab — we'll email you the moment it's ready.`;
    const html = `<p>${esc(line1).replace(esc(name), safeName)}</p>${ctx.createUrl ? button(ctx.createUrl, 'Track your build') : ''}`;
    return {
      subject,
      html,
      text: `${line1}${ctx.createUrl ? `\n\nTrack it: ${ctx.createUrl}` : ''}`,
    };
  }

  if (kind === 'finished') {
    const subject = `${name} — your website is ready`;
    const line1 = `${name}'s website is built and live to preview. Take a look:`;
    const html = `<p>${subject.replace(name, safeName)}</p><p>${esc(line1).replace(esc(name), safeName)}</p>${ctx.previewUrl ? button(ctx.previewUrl, 'View your site') : ''}`;
    return {
      subject,
      html,
      text: `${line1}${ctx.previewUrl ? `\n\nPreview: ${ctx.previewUrl}` : ''}`,
    };
  }

  // failed
  const subject = `We hit a snag building your site`;
  const detail = ctx.error ? ` (${ctx.error})` : '';
  const line1 = `We ran into a problem building ${name}'s website${detail}. We're on it — you can try again now, nothing was lost.`;
  const html = `<p>${esc(line1).replace(esc(name), safeName)}</p>${ctx.createUrl ? button(ctx.createUrl, 'Try again') : ''}`;
  return {
    subject,
    html,
    text: `${line1}${ctx.createUrl ? `\n\nTry again: ${ctx.createUrl}` : ''}`,
  };
}

/** Injected mail sender — real (Resend) in prod, mocked in tests. */
export interface ClaimEmailDeps {
  send: (message: { to: string; subject: string; html: string; text: string }) => Promise<unknown>;
}

/**
 * Render + send a claim-build email. Never throws.
 *
 * @param kind - Which lifecycle email.
 * @param to - Recipient address.
 * @param ctx - Render context.
 * @param deps - Injected `send`.
 * @returns `{ ok }` — `false` when the send threw.
 */
export async function sendClaimBuildEmail(
  kind: ClaimEmailKind,
  to: string,
  ctx: ClaimEmailContext,
  deps: ClaimEmailDeps,
): Promise<{ ok: boolean }> {
  const email = buildClaimEmail(kind, ctx);
  try {
    await deps.send({ to, subject: email.subject, html: email.html, text: email.text });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
