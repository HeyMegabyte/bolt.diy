// Shared resolver for the causal probes. When a probe isn't given CAUSAL_SITE_ID,
// it used to default to the placeholder 'e2e-site-1' / 'acme-bakery' — but the
// e2e-test-org seed site's id is a UUID, so those placeholders 404 EVERY request →
// a false-red 🔴 that masks a genuine pass (cost a diagnosis round-trip on the
// mutations probe). This resolves the org's first real site {id, slug} from
// /api/sites so the probes work out-of-the-box; returns empties if the org has no
// site (caller should skip gracefully, never false-fail). Origin header is required
// or CF Bot Fight challenges the authed call.
export async function resolveE2ESite(base, key, ua) {
  try {
    const r = await fetch(`${base}/api/sites`, {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': ua, Origin: base },
    });
    const j = await r.json().catch(() => ({}));
    const sites = j?.data ?? j;
    const first = (Array.isArray(sites) ? sites : [])[0];
    return { id: first?.id ?? first?.site_id ?? '', slug: first?.slug ?? '' };
  } catch {
    return { id: '', slug: '' };
  }
}
