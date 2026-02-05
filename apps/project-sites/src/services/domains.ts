/**
 * Domains Service Implementation
 * Handles Cloudflare for SaaS custom hostname management
 */
import {
  generateId,
  nowISO,
  slugify,
} from '@project-sites/shared';

// =============================================================================
// TYPES
// =============================================================================

export interface DomainsServiceDeps {
  db: Database;
  kv: KVNamespace;
  cfApiToken: string;
  cfZoneId: string;
  cfAccountId: string;
  freeDomainBase: string;
  fallbackOrigin: string;
}

interface Database {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ rowsAffected: number }>;
}

export interface Hostname {
  id: string;
  siteId: string;
  orgId: string;
  hostname: string;
  isPrimary: boolean;
  isFreeSubdomain: boolean;
  status: 'pending' | 'active' | 'moved' | 'deleted';
  sslStatus: string;
  cfCustomHostnameId: string | null;
  createdAt: string;
  activatedAt: string | null;
}

export interface HostnameStatus {
  hostname: string;
  status: 'pending' | 'active' | 'moved' | 'deleted';
  sslStatus: string;
  verificationMethod: 'cname' | 'txt' | 'http';
  verificationTarget?: string;
  verificationErrors?: string[];
  createdAt: string;
  activatedAt?: string;
}

// =============================================================================
// DOMAINS SERVICE CLASS
// =============================================================================

export class DomainsService {
  private db: Database;
  private kv: KVNamespace;
  private cfApiToken: string;
  private cfZoneId: string;
  private cfAccountId: string;
  private freeDomainBase: string;
  private fallbackOrigin: string;

  constructor(deps: DomainsServiceDeps) {
    this.db = deps.db;
    this.kv = deps.kv;
    this.cfApiToken = deps.cfApiToken;
    this.cfZoneId = deps.cfZoneId;
    this.cfAccountId = deps.cfAccountId;
    this.freeDomainBase = deps.freeDomainBase;
    this.fallbackOrigin = deps.fallbackOrigin;
  }

  // ===========================================================================
  // FREE DOMAIN PROVISIONING
  // ===========================================================================

  async provisionFreeDomain(params: {
    orgId: string;
    siteId: string;
    slug: string;
  }): Promise<{
    hostname: string;
    status: 'pending' | 'active' | 'failed';
    sslStatus: 'pending' | 'active' | 'failed';
    message?: string;
  }> {
    // Sanitize slug for DNS
    const sanitizedSlug = this.sanitizeForDns(params.slug);
    const hostname = `${sanitizedSlug}.${this.freeDomainBase}`;

    // Check if already exists for this site
    const existing = await this.db.query<Hostname>(
      `SELECT * FROM hostnames WHERE site_id = $1 AND is_free_subdomain = true AND status != 'deleted'`,
      [params.siteId],
    );

    if (existing[0]) {
      return {
        hostname: existing[0].hostname,
        status: existing[0].status as 'pending' | 'active' | 'failed',
        sslStatus: existing[0].sslStatus as 'pending' | 'active' | 'failed',
      };
    }

    // Check if hostname is taken by another site
    const taken = await this.db.query<{ id: string }>(
      `SELECT id FROM hostnames WHERE hostname = $1 AND status != 'deleted'`,
      [hostname],
    );

    if (taken[0]) {
      throw new Error('Hostname already taken');
    }

    // Create custom hostname via Cloudflare API
    try {
      const cfResponse = await this.createCfCustomHostname(hostname);

      // Store in database
      const id = generateId();
      await this.db.execute(
        `INSERT INTO hostnames (id, site_id, org_id, hostname, is_primary, is_free_subdomain,
         status, ssl_status, cf_custom_hostname_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          params.siteId,
          params.orgId,
          hostname,
          true,
          true,
          cfResponse.status,
          cfResponse.ssl.status,
          cfResponse.id,
          nowISO(),
        ],
      );

      // Cache hostname mapping
      await this.cacheHostnameMapping(hostname, {
        siteId: params.siteId,
        orgId: params.orgId,
        status: cfResponse.status,
      });

      return {
        hostname,
        status: cfResponse.status,
        sslStatus: cfResponse.ssl.status,
      };
    } catch (error) {
      console.error('Failed to provision free domain:', error);
      return {
        hostname,
        status: 'failed',
        sslStatus: 'failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ===========================================================================
  // CUSTOM HOSTNAME MANAGEMENT
  // ===========================================================================

  async createCustomHostname(params: {
    orgId: string;
    siteId: string;
    hostname: string;
  }): Promise<{
    id: string;
    hostname: string;
    status: 'pending' | 'active' | 'moved' | 'deleted';
    sslStatus: string;
    verificationErrors?: string[];
  }> {
    // Validate hostname format
    const normalizedHostname = this.validateAndNormalizeHostname(params.hostname);

    // Check org is paid
    const orgs = await this.db.query<{ subscription_status: string }>(
      `SELECT subscription_status FROM orgs WHERE id = $1 AND deleted_at IS NULL`,
      [params.orgId],
    );

    if (orgs[0]?.subscription_status !== 'active') {
      throw new Error('Upgrade to a paid plan to add custom domains');
    }

    // Check domain limit (max 5)
    const existing = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM hostnames WHERE org_id = $1 AND is_free_subdomain = false AND status != 'deleted'`,
      [params.orgId],
    );

    if (Number(existing[0]?.count ?? 0) >= 5) {
      throw new Error('Maximum custom domains limit reached (5)');
    }

    // Check hostname not already in use
    const taken = await this.db.query<{ id: string }>(
      `SELECT id FROM hostnames WHERE hostname = $1 AND status != 'deleted'`,
      [normalizedHostname],
    );

    if (taken[0]) {
      throw new Error('Hostname already in use');
    }

    // Check for apex domain (no subdomain)
    const isApex = !normalizedHostname.includes('.') || normalizedHostname.split('.').length === 2;
    const verificationErrors: string[] = [];

    if (isApex) {
      verificationErrors.push(
        'Apex domains require CNAME flattening. We recommend using Cloudflare for your DNS or using a www subdomain.',
      );
    }

    // Create custom hostname via Cloudflare API
    const cfResponse = await this.createCfCustomHostname(normalizedHostname);

    // Store in database
    const id = generateId();
    await this.db.execute(
      `INSERT INTO hostnames (id, site_id, org_id, hostname, is_primary, is_free_subdomain,
       status, ssl_status, cf_custom_hostname_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        params.siteId,
        params.orgId,
        normalizedHostname,
        false,
        false,
        cfResponse.status,
        cfResponse.ssl.status,
        cfResponse.id,
        nowISO(),
      ],
    );

    // Cache hostname mapping
    await this.cacheHostnameMapping(normalizedHostname, {
      siteId: params.siteId,
      orgId: params.orgId,
      status: cfResponse.status,
    });

    return {
      id,
      hostname: normalizedHostname,
      status: cfResponse.status,
      sslStatus: cfResponse.ssl.status,
      verificationErrors: verificationErrors.length > 0 ? verificationErrors : undefined,
    };
  }

  async getHostnameStatus(hostname: string): Promise<HostnameStatus | null> {
    // Check cache first
    const cached = await this.kv.get(`hostname:status:${hostname}`);
    if (cached) {
      const status = JSON.parse(cached);
      // Cache hit, return if fresh (< 5 min)
      if (Date.now() - status.cachedAt < 300000) {
        return status;
      }
    }

    // Get from database
    const hostnames = await this.db.query<Hostname & { cf_custom_hostname_id: string }>(
      `SELECT * FROM hostnames WHERE hostname = $1 AND status != 'deleted'`,
      [hostname],
    );

    const record = hostnames[0];
    if (!record) {
      return null;
    }

    // Get status from Cloudflare
    if (record.cf_custom_hostname_id) {
      const cfStatus = await this.getCfCustomHostname(record.cf_custom_hostname_id);

      // Update local record if status changed
      if (cfStatus && cfStatus.status !== record.status) {
        await this.db.execute(
          `UPDATE hostnames SET status = $1, ssl_status = $2, activated_at = $3, updated_at = $4 WHERE id = $5`,
          [
            cfStatus.status,
            cfStatus.ssl.status,
            cfStatus.status === 'active' ? nowISO() : null,
            nowISO(),
            record.id,
          ],
        );
      }

      const status: HostnameStatus = {
        hostname,
        status: cfStatus?.status ?? record.status,
        sslStatus: cfStatus?.ssl?.status ?? record.sslStatus,
        verificationMethod: 'cname',
        createdAt: record.createdAt,
        activatedAt: record.activatedAt ?? undefined,
      };

      // Cache for 5 minutes
      await this.kv.put(`hostname:status:${hostname}`, JSON.stringify({
        ...status,
        cachedAt: Date.now(),
      }), { expirationTtl: 300 });

      return status;
    }

    return {
      hostname,
      status: record.status,
      sslStatus: record.sslStatus,
      verificationMethod: 'cname',
      createdAt: record.createdAt,
      activatedAt: record.activatedAt ?? undefined,
    };
  }

  async deleteCustomHostname(hostname: string, orgId: string): Promise<void> {
    // Find hostname
    const hostnames = await this.db.query<Hostname & { cf_custom_hostname_id: string }>(
      `SELECT * FROM hostnames WHERE hostname = $1 AND status != 'deleted'`,
      [hostname],
    );

    const record = hostnames[0];
    if (!record) {
      return;
    }

    // Check ownership
    if (record.orgId !== orgId) {
      throw new Error('Unauthorized');
    }

    // Prevent deleting free subdomain
    if (record.isFreeSubdomain) {
      throw new Error('Cannot delete free subdomain');
    }

    // Delete from Cloudflare
    if (record.cf_custom_hostname_id) {
      await this.deleteCfCustomHostname(record.cf_custom_hostname_id);
    }

    // Mark as deleted
    await this.db.execute(
      `UPDATE hostnames SET status = 'deleted', updated_at = $1 WHERE id = $2`,
      [nowISO(), record.id],
    );

    // Clear cache
    await this.kv.delete(`host:${hostname}`);
    await this.kv.delete(`hostname:status:${hostname}`);
  }

  // ===========================================================================
  // SITE HOSTNAMES
  // ===========================================================================

  async getSiteHostnames(siteId: string): Promise<Hostname[]> {
    const hostnames = await this.db.query<Hostname>(
      `SELECT id, site_id as "siteId", org_id as "orgId", hostname, is_primary as "isPrimary",
       is_free_subdomain as "isFreeSubdomain", status, ssl_status as "sslStatus",
       cf_custom_hostname_id as "cfCustomHostnameId", created_at as "createdAt",
       activated_at as "activatedAt"
       FROM hostnames WHERE site_id = $1 AND status != 'deleted'
       ORDER BY is_primary DESC, created_at ASC`,
      [siteId],
    );

    return hostnames;
  }

  async getHostnameByDomain(domain: string): Promise<Hostname | null> {
    // Check KV cache
    const cached = await this.kv.get(`host:${domain}`);
    if (cached) {
      const data = JSON.parse(cached);
      return {
        id: '',
        siteId: data.siteId,
        orgId: data.orgId,
        hostname: domain,
        isPrimary: false,
        isFreeSubdomain: domain.endsWith(this.freeDomainBase),
        status: data.status,
        sslStatus: 'active',
        cfCustomHostnameId: null,
        createdAt: '',
        activatedAt: null,
      };
    }

    // Query database
    const hostnames = await this.db.query<Hostname>(
      `SELECT id, site_id as "siteId", org_id as "orgId", hostname, is_primary as "isPrimary",
       is_free_subdomain as "isFreeSubdomain", status, ssl_status as "sslStatus",
       cf_custom_hostname_id as "cfCustomHostnameId", created_at as "createdAt",
       activated_at as "activatedAt"
       FROM hostnames WHERE hostname = $1 AND status != 'deleted'`,
      [domain],
    );

    const hostname = hostnames[0];
    if (hostname) {
      await this.cacheHostnameMapping(domain, {
        siteId: hostname.siteId,
        orgId: hostname.orgId,
        status: hostname.status,
      });
    }

    return hostname ?? null;
  }

  // ===========================================================================
  // VERIFICATION
  // ===========================================================================

  async verifyPendingHostnames(): Promise<Array<{
    hostname: string;
    previousStatus: string;
    newStatus: string;
    sslStatus: string;
    success: boolean;
    errors?: string[];
  }>> {
    // Get all pending hostnames
    const pending = await this.db.query<Hostname & { cf_custom_hostname_id: string }>(
      `SELECT * FROM hostnames WHERE status = 'pending'`,
      [],
    );

    const results = [];

    for (const record of pending) {
      if (!record.cf_custom_hostname_id) continue;

      const cfStatus = await this.getCfCustomHostname(record.cf_custom_hostname_id);

      if (!cfStatus) {
        results.push({
          hostname: record.hostname,
          previousStatus: record.status,
          newStatus: 'pending',
          sslStatus: record.sslStatus,
          success: false,
          errors: ['Could not fetch status from Cloudflare'],
        });
        continue;
      }

      const success = cfStatus.status === 'active';

      if (cfStatus.status !== record.status) {
        await this.db.execute(
          `UPDATE hostnames SET status = $1, ssl_status = $2, activated_at = $3, updated_at = $4 WHERE id = $5`,
          [
            cfStatus.status,
            cfStatus.ssl.status,
            cfStatus.status === 'active' ? nowISO() : null,
            nowISO(),
            record.id,
          ],
        );

        if (success) {
          await this.cacheHostnameMapping(record.hostname, {
            siteId: record.siteId,
            orgId: record.orgId,
            status: 'active',
          });
        }
      }

      results.push({
        hostname: record.hostname,
        previousStatus: record.status,
        newStatus: cfStatus.status,
        sslStatus: cfStatus.ssl.status,
        success,
        errors: cfStatus.ssl.validation_errors,
      });
    }

    return results;
  }

  async verifyHostname(hostname: string): Promise<{
    hostname: string;
    previousStatus: string;
    newStatus: string;
    sslStatus: string;
    success: boolean;
    errors?: string[];
  }> {
    const record = await this.db.query<Hostname & { cf_custom_hostname_id: string }>(
      `SELECT * FROM hostnames WHERE hostname = $1 AND status != 'deleted'`,
      [hostname],
    );

    if (!record[0] || !record[0].cf_custom_hostname_id) {
      return {
        hostname,
        previousStatus: 'unknown',
        newStatus: 'unknown',
        sslStatus: 'unknown',
        success: false,
        errors: ['Hostname not found'],
      };
    }

    const cfStatus = await this.getCfCustomHostname(record[0].cf_custom_hostname_id);

    if (!cfStatus) {
      return {
        hostname,
        previousStatus: record[0].status,
        newStatus: record[0].status,
        sslStatus: record[0].sslStatus,
        success: false,
        errors: ['Could not fetch status from Cloudflare'],
      };
    }

    const success = cfStatus.status === 'active';

    if (cfStatus.status !== record[0].status) {
      await this.db.execute(
        `UPDATE hostnames SET status = $1, ssl_status = $2, activated_at = $3, updated_at = $4 WHERE id = $5`,
        [
          cfStatus.status,
          cfStatus.ssl.status,
          cfStatus.status === 'active' ? nowISO() : null,
          nowISO(),
          record[0].id,
        ],
      );
    }

    return {
      hostname,
      previousStatus: record[0].status,
      newStatus: cfStatus.status,
      sslStatus: cfStatus.ssl.status,
      success,
      errors: cfStatus.ssl.validation_errors,
    };
  }

  // ===========================================================================
  // DNS VALIDATION
  // ===========================================================================

  async validateCnameTarget(hostname: string, expectedTarget: string): Promise<{
    valid: boolean;
    resolvedTo: string | null;
    expectedTarget: string;
    error?: string;
  }> {
    try {
      const response = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=CNAME`,
        {
          headers: { Accept: 'application/dns-json' },
        },
      );

      if (!response.ok) {
        return {
          valid: false,
          resolvedTo: null,
          expectedTarget,
          error: 'DNS lookup failed',
        };
      }

      const data = await response.json() as { Answer?: Array<{ data: string }> };
      const records = data.Answer ?? [];

      for (const record of records) {
        const target = record.data.replace(/\.$/, ''); // Remove trailing dot
        if (target === expectedTarget || target.endsWith(`.${expectedTarget}`)) {
          return {
            valid: true,
            resolvedTo: target,
            expectedTarget,
          };
        }
      }

      return {
        valid: false,
        resolvedTo: records[0]?.data?.replace(/\.$/, '') ?? null,
        expectedTarget,
      };
    } catch (error) {
      return {
        valid: false,
        resolvedTo: null,
        expectedTarget,
        error: error instanceof Error ? error.message : 'DNS lookup failed',
      };
    }
  }

  // ===========================================================================
  // CLOUDFLARE API
  // ===========================================================================

  private async createCfCustomHostname(hostname: string): Promise<{
    id: string;
    hostname: string;
    status: 'pending' | 'active' | 'moved' | 'deleted';
    ssl: { status: string };
  }> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.cfZoneId}/custom_hostnames`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname,
          ssl: {
            method: 'http',
            type: 'dv',
          },
        }),
      },
    );

    const data = await response.json() as { success: boolean; result?: any; errors?: any[] };

    if (!data.success) {
      throw new Error(data.errors?.[0]?.message ?? 'Cloudflare API error');
    }

    return data.result;
  }

  private async getCfCustomHostname(customHostnameId: string): Promise<{
    id: string;
    hostname: string;
    status: 'pending' | 'active' | 'moved' | 'deleted';
    ssl: { status: string; validation_errors?: string[] };
  } | null> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.cfZoneId}/custom_hostnames/${customHostnameId}`,
      {
        headers: {
          Authorization: `Bearer ${this.cfApiToken}`,
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { success: boolean; result?: any };

    if (!data.success) {
      return null;
    }

    return data.result;
  }

  private async deleteCfCustomHostname(customHostnameId: string): Promise<void> {
    await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.cfZoneId}/custom_hostnames/${customHostnameId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.cfApiToken}`,
        },
      },
    );
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private sanitizeForDns(slug: string): string {
    return slugify(slug)
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 63);
  }

  private validateAndNormalizeHostname(hostname: string): string {
    // Remove protocol if present
    let normalized = hostname.toLowerCase().trim();
    normalized = normalized.replace(/^https?:\/\//, '');
    normalized = normalized.replace(/\/.*$/, '');

    // Validate characters
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(normalized)) {
      throw new Error('Invalid hostname format');
    }

    // Check for null bytes or other invalid chars
    if (/[\x00-\x1f\x7f]/.test(hostname)) {
      throw new Error('Invalid hostname format');
    }

    // Check length
    if (normalized.length > 253) {
      throw new Error('Hostname too long');
    }

    return normalized;
  }

  private async cacheHostnameMapping(hostname: string, data: {
    siteId: string;
    orgId: string;
    status: string;
  }): Promise<void> {
    await this.kv.put(`host:${hostname}`, JSON.stringify(data), {
      expirationTtl: 300, // 5 minutes
    });
  }
}
