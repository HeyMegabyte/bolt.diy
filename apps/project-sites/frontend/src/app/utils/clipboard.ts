/**
 * Best-effort copy to the clipboard.
 *
 * `navigator.clipboard.writeText` REJECTS when the clipboard is unavailable —
 * an insecure context, a denied permission, or a headless browser (where it
 * throws `NotAllowedError: Write permission denied`). An un-`.catch()`-ed call
 * becomes an unhandled promise rejection, which in Karma/headless intermittently
 * crashes the whole test run ("error thrown in afterAll" → disconnect) and in
 * prod surfaces as a console error. This helper swallows that — it NEVER throws
 * or rejects — and reports success so callers can show a toast.
 *
 * @param text - the text to copy.
 * @returns `true` if the write succeeded, `false` otherwise (never throws).
 *
 * @example
 * if (await copyToClipboard(url)) this.toast.success('Copied');
 * else this.toast.error('Copy failed — select and copy manually');
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
