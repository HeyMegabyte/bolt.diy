/**
 * Customer Portal (#79, ROI 2.13) — pure client portal access engine.
 * Magic-link auth, per-client page access control. Zero I/O.
 */
export interface PortalConfig {
  portalId: string; clientId: string; clientName: string;
  magicLinkToken: string; accessiblePages: string[];
  createdAt: string; expiresAt: string;
}

export function createPortal(clientId: string, clientName: string, pages: string[]): PortalConfig {
  return {
    portalId: `portal_${clientId.slice(0, 8)}`,
    clientId, clientName,
    magicLinkToken: `ml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    accessiblePages: pages,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  };
}

export function validateAccess(portal: PortalConfig, token: string, page: string): boolean {
  if (new Date(portal.expiresAt).getTime() < Date.now()) return false;
  if (portal.magicLinkToken !== token) return false;
  return portal.accessiblePages.some((p) => page.startsWith(p));
}

export function listPages(portal: PortalConfig): string[] {
  return [...portal.accessiblePages];
}

export function generateMagicLink(portal: PortalConfig, email: string): string {
  return `https://portal.projectsites.dev/${portal.portalId}?token=${portal.magicLinkToken}&email=${encodeURIComponent(email)}`;
}

export function isExpired(portal: PortalConfig): boolean {
  return new Date(portal.expiresAt).getTime() < Date.now();
}
