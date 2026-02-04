/**
 * Domains service
 * Cloudflare for SaaS custom hostname management
 */
import type { AppContext } from '../types.js';
import {
  generateUuid,
  ExternalServiceError,
  DOMAINS,
  HOSTNAME_STATES,
} from '@project-sites/shared';

interface HostnameStatus {
  active: boolean;
  ssl_status: string;
  errors: string[];
}

export class DomainsService {
  constructor(private c: AppContext) {}

  private get db() {
    return this.c.get('db');
  }

  private get env() {
    return this.c.env;
  }

  // ============================================================================
  // CLOUDFLARE API
  // ============================================================================

  private async cfApi(
    endpoint: string,
    method: string = 'GET',
    body?: Record<string, unknown>
  ): Promise<any> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.env.CF_ZONE_ID}${endpoint}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.env.CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      }
    );

    const data = await response.json() as { success: boolean; result: any; errors?: any[] };

    if (!data.success) {
      console.error('Cloudflare API error:', data.errors);
      throw new ExternalServiceError(
        'Cloudflare',
        data.errors?.[0]?.message || 'Unknown error'
      );
    }

    return data.result;
  }

  // ============================================================================
  // CUSTOM HOSTNAME MANAGEMENT
  // ============================================================================

  async provisionFreeDomain(params: {
    org_id: string;
    site_id: string;
    slug: string;
  }): Promise<void> {
    const hostname = `${params.slug}.${DOMAINS.SITES_BASE}`;

    // Check if already exists
    const { data: existing } = await this.db
      .from('hostnames')
      .select('id')
      .eq('hostname', hostname)
      .single();

    if (existing) {
      return; // Already provisioned
    }

    // Create custom hostname in Cloudflare
    const result = await this.cfApi('/custom_hostnames', 'POST', {
      hostname,
      ssl: {
        method: 'http',
        type: 'dv',
        settings: {
          http2: 'on',
          min_tls_version: '1.2',
          tls_1_3: 'on',
        },
      },
    });

    // Store in database
    await this.db.from('hostnames').insert({
      id: generateUuid(),
      org_id: params.org_id,
      site_id: params.site_id,
      hostname,
      cf_hostname_id: result.id,
      state: 'pending',
      is_free_domain: true,
      ssl_status: result.ssl?.status,
    });
  }

  async provisionCustomDomain(params: {
    org_id: string;
    site_id: string;
    hostname: string;
  }): Promise<void> {
    // Create custom hostname in Cloudflare for SaaS
    const result = await this.cfApi('/custom_hostnames', 'POST', {
      hostname: params.hostname,
      ssl: {
        method: 'http',
        type: 'dv',
        settings: {
          http2: 'on',
          min_tls_version: '1.2',
          tls_1_3: 'on',
        },
      },
      custom_metadata: {
        org_id: params.org_id,
        site_id: params.site_id,
      },
    });

    // Update database
    await this.db
      .from('hostnames')
      .update({
        cf_hostname_id: result.id,
        ssl_status: result.ssl?.status,
        updated_at: new Date().toISOString(),
      })
      .eq('site_id', params.site_id)
      .eq('hostname', params.hostname);
  }

  async verifyHostname(params: { hostname: string }): Promise<HostnameStatus> {
    // Get hostname from database
    const { data: hostnameRecord } = await this.db
      .from('hostnames')
      .select('cf_hostname_id')
      .eq('hostname', params.hostname)
      .single();

    if (!hostnameRecord?.cf_hostname_id) {
      return {
        active: false,
        ssl_status: 'not_provisioned',
        errors: ['Hostname not provisioned in Cloudflare'],
      };
    }

    // Check status in Cloudflare
    const result = await this.cfApi(`/custom_hostnames/${hostnameRecord.cf_hostname_id}`);

    const errors: string[] = [];

    // Check ownership verification
    if (result.ownership_verification?.type === 'txt') {
      // DNS TXT verification required (but we use CNAME, so this shouldn't happen)
      errors.push('DNS verification pending');
    }

    // Check SSL status
    if (result.ssl?.status !== 'active') {
      errors.push(`SSL status: ${result.ssl?.status}`);
    }

    // Check if hostname is active
    const isActive = result.status === 'active' && result.ssl?.status === 'active';

    return {
      active: isActive,
      ssl_status: result.ssl?.status || 'unknown',
      errors,
    };
  }

  async deprovisionHostname(params: { hostname: string }): Promise<void> {
    // Get hostname from database
    const { data: hostnameRecord } = await this.db
      .from('hostnames')
      .select('cf_hostname_id')
      .eq('hostname', params.hostname)
      .single();

    if (!hostnameRecord?.cf_hostname_id) {
      return; // Nothing to delete
    }

    // Delete from Cloudflare
    try {
      await this.cfApi(`/custom_hostnames/${hostnameRecord.cf_hostname_id}`, 'DELETE');
    } catch (error) {
      console.error('Failed to delete hostname from Cloudflare:', error);
    }
  }

  async getSiteHostnames(siteId: string): Promise<any[]> {
    const { data: hostnames, error } = await this.db
      .from('hostnames')
      .select('*')
      .eq('site_id', siteId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return hostnames || [];
  }

  async getHostnameByDomain(hostname: string): Promise<any | null> {
    const { data } = await this.db
      .from('hostnames')
      .select('*')
      .eq('hostname', hostname)
      .is('deleted_at', null)
      .single();

    return data;
  }

  // ============================================================================
  // SCHEDULED VERIFICATION
  // ============================================================================

  async verifyPendingHostnames(): Promise<void> {
    // Get all pending hostnames
    const { data: pendingHostnames, error } = await this.db
      .from('hostnames')
      .select('*')
      .eq('state', 'pending')
      .is('deleted_at', null)
      .limit(50);

    if (error || !pendingHostnames) {
      console.error('Failed to get pending hostnames:', error);
      return;
    }

    for (const hostname of pendingHostnames) {
      try {
        const status = await this.verifyHostname({ hostname: hostname.hostname });

        // Update status
        await this.db
          .from('hostnames')
          .update({
            state: status.active ? 'active' : 'pending',
            ssl_status: status.ssl_status,
            verification_errors: status.errors.length > 0 ? status.errors : null,
            last_verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', hostname.id);

        // Cache active hostname
        if (status.active) {
          await this.c.env.CACHE_KV.put(
            `host:${hostname.hostname}`,
            hostname.site_id,
            { expirationTtl: 3600 }
          );
        }
      } catch (error) {
        console.error(`Failed to verify hostname ${hostname.hostname}:`, error);
      }
    }
  }

  // ============================================================================
  // DNS HELPERS
  // ============================================================================

  async checkCnameResolution(hostname: string): Promise<boolean> {
    try {
      // Use DNS over HTTPS to check CNAME
      const response = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${hostname}&type=CNAME`,
        {
          headers: { Accept: 'application/dns-json' },
        }
      );

      const data = await response.json() as { Answer?: Array<{ data: string }> };

      // Check if CNAME points to our domain
      const answers = data.Answer || [];
      return answers.some(
        (a) =>
          a.data.includes(DOMAINS.SITES_BASE) ||
          a.data.includes('sites.megabyte.space')
      );
    } catch (error) {
      console.error('DNS resolution check failed:', error);
      return false;
    }
  }
}
