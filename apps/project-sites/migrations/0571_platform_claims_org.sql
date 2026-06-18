-- claimyour.site (#1) — the platform org that owns claim-built sites BEFORE the
-- visitor signs in and claims them (design option A: speculative-resource owned
-- by a system org, ownership transfers to the user's org on claim).
-- A claim build provisions a `sites` row up front; sites.org_id is NOT NULL and
-- the anonymous visitor has no org yet, so the site is parented here until the
-- claim transfer step re-parents it. Additive + idempotent.
INSERT OR IGNORE INTO orgs (id, name, slug)
VALUES ('org_platform_claims', 'ProjectSites Platform — claim builds', 'platform-claims');
