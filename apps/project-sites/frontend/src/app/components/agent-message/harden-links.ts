/**
 * Post-sanitize link hardening for rendered AI-markdown.
 *
 * Runs on the ALREADY-DOMPurify-sanitized HTML string, so the `href` is trusted
 * and we only inject STATIC literal attributes (no user-derived values → no
 * injection vector). External http(s) anchors get:
 *   - `target="_blank"`  → clicking a cited source opens a new tab instead of
 *     navigating the admin SPA away (which would lose the user's chat/session).
 *   - `rel="noopener noreferrer"` → reverse-tabnabbing guard (a `_blank` link
 *     otherwise leaves `window.opener` reachable by the opened page).
 *
 * Relative / mailto / tel / in-app links are left untouched (no new tab for
 * internal navigation), and anchors that already declare a `target` are skipped.
 */
export function hardenExternalLinks(html: string): string {
  return html.replace(
    /<a (href="https?:\/\/[^"]*")([^>]*)>/gi,
    (match, href: string, rest: string) =>
      /\btarget=/.test(rest) ? match : `<a ${href}${rest} target="_blank" rel="noopener noreferrer">`,
  );
}
