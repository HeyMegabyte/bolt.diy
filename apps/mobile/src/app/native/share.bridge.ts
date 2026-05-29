import { Share } from '@capacitor/share';

/**
 * Share a generated site URL via the OS share sheet (Messages, Mail, X,
 * WhatsApp, Slack, etc).
 *
 * The "share extension" trigger lives in the host SPA's site card — e.g.
 * the user taps "Share" in `/admin/sites/:slug` and the SPA calls this.
 */
export async function shareSiteUrl(
  slug: string,
  title: string,
): Promise<boolean> {
  const url = `https://${slug}.projectsites.dev`;
  const result = await Share.canShare();
  if (!result.value) return false;

  await Share.share({
    title,
    text: `Check out ${title} — built on ProjectSites`,
    url,
    dialogTitle: 'Share site',
  });
  return true;
}
