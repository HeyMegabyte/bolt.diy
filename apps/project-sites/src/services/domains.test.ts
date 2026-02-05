/**
 * Domains Service Tests - TDD
 * Tests for Cloudflare for SaaS custom hostname management
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Types for testing
interface DomainsService {
  // Free domain provisioning (paid checkout flow)
  provisionFreeDomain(params: ProvisionFreeDomainParams): Promise<ProvisionResult>;

  // Custom domain management
  createCustomHostname(params: CreateHostnameParams): Promise<HostnameResult>;
  getHostnameStatus(hostname: string): Promise<HostnameStatus | null>;
  deleteCustomHostname(hostname: string, orgId: string): Promise<void>;

  // Site hostnames
  getSiteHostnames(siteId: string): Promise<Hostname[]>;
  getHostnameByDomain(domain: string): Promise<Hostname | null>;

  // Verification
  verifyPendingHostnames(): Promise<VerificationResult[]>;
  verifyHostname(hostname: string): Promise<VerificationResult>;

  // DNS validation
  validateCnameTarget(hostname: string, expectedTarget: string): Promise<DnsValidationResult>;
}

interface ProvisionFreeDomainParams {
  orgId: string;
  siteId: string;
  slug: string;
}

interface ProvisionResult {
  hostname: string;
  status: 'pending' | 'active' | 'failed';
  sslStatus: 'pending' | 'active' | 'failed';
  message?: string;
}

interface CreateHostnameParams {
  orgId: string;
  siteId: string;
  hostname: string;
}

interface HostnameResult {
  id: string;
  hostname: string;
  status: 'pending' | 'active' | 'moved' | 'deleted';
  sslStatus: 'initializing' | 'pending_validation' | 'pending_issuance' | 'pending_deployment' | 'active';
  verificationErrors?: string[];
}

interface HostnameStatus {
  hostname: string;
  status: 'pending' | 'active' | 'moved' | 'deleted';
  sslStatus: string;
  verificationMethod: 'cname' | 'txt' | 'http';
  verificationTarget?: string;
  verificationErrors?: string[];
  createdAt: string;
  activatedAt?: string;
}

interface Hostname {
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

interface VerificationResult {
  hostname: string;
  previousStatus: string;
  newStatus: string;
  sslStatus: string;
  success: boolean;
  errors?: string[];
}

interface DnsValidationResult {
  valid: boolean;
  resolvedTo: string | null;
  expectedTarget: string;
  error?: string;
}

// Mock Cloudflare API
const mockCfApi = {
  customHostnames: {
    create: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
  },
  dns: {
    resolve: jest.fn(),
  },
};

const mockDb = {
  hostnames: new Map<string, any>(),
  sites: new Map<string, any>(),
  orgs: new Map<string, any>(),

  reset() {
    this.hostnames.clear();
    this.sites.clear();
    this.orgs.clear();
  },
};

const mockKv = {
  cache: new Map<string, any>(),

  get: jest.fn((key: string) => mockKv.cache.get(key)),
  put: jest.fn((key: string, value: any) => mockKv.cache.set(key, value)),
  delete: jest.fn((key: string) => mockKv.cache.delete(key)),

  reset() {
    this.cache.clear();
    jest.clearAllMocks();
  },
};

let domainsService: DomainsService;

// Constants
const FREE_DOMAIN_BASE = 'sites.megabyte.space';
const FALLBACK_ORIGIN = 'sites.megabyte.space';

describe('DomainsService', () => {
  beforeEach(() => {
    mockDb.reset();
    mockKv.reset();
    jest.clearAllMocks();

    // Setup default test data
    mockDb.orgs.set('test-org-id', {
      id: 'test-org-id',
      name: 'Test Org',
      subscriptionStatus: 'active',
    });

    mockDb.sites.set('test-site-id', {
      id: 'test-site-id',
      orgId: 'test-org-id',
      slug: 'test-business',
    });
  });

  // ==========================================================================
  // FREE DOMAIN PROVISIONING
  // ==========================================================================
  describe('Free Domain Provisioning', () => {
    describe('provisionFreeDomain', () => {
      beforeEach(() => {
        mockCfApi.customHostnames.create.mockResolvedValue({
          id: 'cf-hostname-id-123',
          hostname: 'test-business.sites.megabyte.space',
          status: 'pending',
          ssl: { status: 'pending_validation' },
        });
      });

      it('should provision free subdomain on checkout completion', async () => {
        const result = await domainsService.provisionFreeDomain({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          slug: 'test-business',
        });

        expect(result.hostname).toBe('test-business.sites.megabyte.space');
        expect(result.status).toBe('pending');
      });

      it('should create Cloudflare for SaaS custom hostname', async () => {
        await domainsService.provisionFreeDomain({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          slug: 'test-business',
        });

        expect(mockCfApi.customHostnames.create).toHaveBeenCalledWith(
          expect.objectContaining({
            hostname: 'test-business.sites.megabyte.space',
            ssl: expect.objectContaining({
              method: 'http',
              type: 'dv',
            }),
          }),
        );
      });

      it('should store hostname in database', async () => {
        await domainsService.provisionFreeDomain({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          slug: 'test-business',
        });

        // Verify DB record created
        const hostname = Array.from(mockDb.hostnames.values()).find(
          (h) => h.hostname === 'test-business.sites.megabyte.space',
        );
        expect(hostname).toBeDefined();
        expect(hostname.isFreeSubdomain).toBe(true);
        expect(hostname.orgId).toBe('test-org-id');
        expect(hostname.siteId).toBe('test-site-id');
      });

      it('should cache hostname mapping in KV', async () => {
        await domainsService.provisionFreeDomain({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          slug: 'test-business',
        });

        expect(mockKv.put).toHaveBeenCalledWith(
          'host:test-business.sites.megabyte.space',
          expect.any(String),
          expect.any(Object),
        );
      });

      it('should reject duplicate slugs', async () => {
        // First provision
        await domainsService.provisionFreeDomain({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          slug: 'taken-slug',
        });

        // Different org/site trying same slug
        mockDb.sites.set('other-site-id', {
          id: 'other-site-id',
          orgId: 'other-org-id',
          slug: 'taken-slug',
        });

        await expect(
          domainsService.provisionFreeDomain({
            orgId: 'other-org-id',
            siteId: 'other-site-id',
            slug: 'taken-slug',
          }),
        ).rejects.toThrow(/already taken|exists/i);
      });

      it('should sanitize slug for DNS compatibility', async () => {
        const result = await domainsService.provisionFreeDomain({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          slug: "John's Café & Bar!!",
        });

        // Should be sanitized to DNS-safe format
        expect(result.hostname).toMatch(/^[a-z0-9-]+\.sites\.megabyte\.space$/);
        expect(result.hostname).not.toContain("'");
        expect(result.hostname).not.toContain('&');
        expect(result.hostname).not.toContain('!');
      });

      it('should handle Cloudflare API errors gracefully', async () => {
        mockCfApi.customHostnames.create.mockRejectedValue(
          new Error('Cloudflare API error'),
        );

        const result = await domainsService.provisionFreeDomain({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          slug: 'test-business',
        });

        expect(result.status).toBe('failed');
        expect(result.message).toBeDefined();
      });

      it('should be idempotent (re-provisioning same slug returns existing)', async () => {
        // First provision
        const first = await domainsService.provisionFreeDomain({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          slug: 'test-business',
        });

        // Second provision for same site
        const second = await domainsService.provisionFreeDomain({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          slug: 'test-business',
        });

        expect(second.hostname).toBe(first.hostname);
        // Should not create duplicate CF hostname
        expect(mockCfApi.customHostnames.create).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ==========================================================================
  // CUSTOM HOSTNAME MANAGEMENT
  // ==========================================================================
  describe('Custom Hostname Management', () => {
    describe('createCustomHostname', () => {
      beforeEach(() => {
        // Org must be paid
        mockDb.orgs.set('test-org-id', {
          id: 'test-org-id',
          subscriptionStatus: 'active',
        });

        mockCfApi.customHostnames.create.mockResolvedValue({
          id: 'cf-hostname-id-456',
          hostname: 'www.example.com',
          status: 'pending',
          ssl: { status: 'pending_validation' },
          verification_type: 'cname',
          verification: {
            cname_target: 'dcv.digicert.com',
          },
        });
      });

      it('should create custom hostname for paid org', async () => {
        const result = await domainsService.createCustomHostname({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          hostname: 'www.example.com',
        });

        expect(result.hostname).toBe('www.example.com');
        expect(result.status).toBe('pending');
      });

      it('should reject custom hostname for free org', async () => {
        mockDb.orgs.set('free-org-id', {
          id: 'free-org-id',
          subscriptionStatus: 'none',
        });

        await expect(
          domainsService.createCustomHostname({
            orgId: 'free-org-id',
            siteId: 'test-site-id',
            hostname: 'www.example.com',
          }),
        ).rejects.toThrow(/upgrade|paid/i);
      });

      it('should enforce max 5 custom domains per org', async () => {
        // Create 5 existing hostnames
        for (let i = 0; i < 5; i++) {
          mockDb.hostnames.set(`hostname-${i}`, {
            id: `hostname-${i}`,
            orgId: 'test-org-id',
            hostname: `domain${i}.example.com`,
            isFreeSubdomain: false,
          });
        }

        await expect(
          domainsService.createCustomHostname({
            orgId: 'test-org-id',
            siteId: 'test-site-id',
            hostname: 'domain6.example.com',
          }),
        ).rejects.toThrow(/maximum|limit/i);
      });

      it('should reject invalid hostname format', async () => {
        await expect(
          domainsService.createCustomHostname({
            orgId: 'test-org-id',
            siteId: 'test-site-id',
            hostname: 'invalid hostname with spaces',
          }),
        ).rejects.toThrow(/invalid/i);
      });

      it('should reject hostname with protocol', async () => {
        await expect(
          domainsService.createCustomHostname({
            orgId: 'test-org-id',
            siteId: 'test-site-id',
            hostname: 'https://www.example.com',
          }),
        ).rejects.toThrow(/invalid/i);
      });

      it('should reject apex domains with CNAME warning', async () => {
        // Apex domains require special handling
        const result = await domainsService.createCustomHostname({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          hostname: 'example.com', // apex, no subdomain
        });

        // Should still create but with warning about CNAME at apex
        expect(result.verificationErrors).toContain(
          expect.stringMatching(/apex|root|CNAME|cloudflare/i),
        );
      });

      it('should reject hostname already in use', async () => {
        mockDb.hostnames.set('existing', {
          hostname: 'www.taken.com',
          orgId: 'other-org-id',
        });

        await expect(
          domainsService.createCustomHostname({
            orgId: 'test-org-id',
            siteId: 'test-site-id',
            hostname: 'www.taken.com',
          }),
        ).rejects.toThrow(/already in use/i);
      });

      it('should validate CNAME points to correct target', async () => {
        mockCfApi.dns.resolve.mockResolvedValue({
          records: [{ value: 'sites.megabyte.space' }],
        });

        const result = await domainsService.createCustomHostname({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          hostname: 'www.example.com',
        });

        // Should check CNAME is correct
        expect(result.status).toBeDefined();
      });
    });

    describe('getHostnameStatus', () => {
      beforeEach(() => {
        mockDb.hostnames.set('hostname-123', {
          id: 'hostname-123',
          hostname: 'www.example.com',
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          status: 'pending',
          cfCustomHostnameId: 'cf-123',
        });

        mockCfApi.customHostnames.get.mockResolvedValue({
          id: 'cf-123',
          hostname: 'www.example.com',
          status: 'active',
          ssl: { status: 'active' },
        });
      });

      it('should return current status from Cloudflare', async () => {
        const status = await domainsService.getHostnameStatus('www.example.com');

        expect(status).toBeDefined();
        expect(status?.status).toBe('active');
        expect(status?.sslStatus).toBe('active');
      });

      it('should return null for unknown hostname', async () => {
        const status = await domainsService.getHostnameStatus('unknown.example.com');

        expect(status).toBeNull();
      });

      it('should include verification instructions for pending hostnames', async () => {
        mockCfApi.customHostnames.get.mockResolvedValue({
          id: 'cf-123',
          hostname: 'www.example.com',
          status: 'pending',
          ssl: { status: 'pending_validation' },
          verification_type: 'cname',
        });

        const status = await domainsService.getHostnameStatus('www.example.com');

        expect(status?.status).toBe('pending');
        expect(status?.verificationMethod).toBeDefined();
      });

      it('should cache status in KV', async () => {
        await domainsService.getHostnameStatus('www.example.com');

        expect(mockKv.put).toHaveBeenCalledWith(
          expect.stringContaining('www.example.com'),
          expect.any(String),
          expect.any(Object),
        );
      });

      it('should return cached status if fresh', async () => {
        // Pre-populate cache
        mockKv.cache.set('host:www.example.com', JSON.stringify({
          status: 'active',
          sslStatus: 'active',
          cachedAt: Date.now(),
        }));

        await domainsService.getHostnameStatus('www.example.com');

        // Should not call Cloudflare API if cache is fresh
        // (behavior depends on TTL implementation)
      });
    });

    describe('deleteCustomHostname', () => {
      beforeEach(() => {
        mockDb.hostnames.set('hostname-123', {
          id: 'hostname-123',
          hostname: 'www.example.com',
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          cfCustomHostnameId: 'cf-123',
        });

        mockCfApi.customHostnames.delete.mockResolvedValue({ success: true });
      });

      it('should delete hostname from Cloudflare', async () => {
        await domainsService.deleteCustomHostname('www.example.com', 'test-org-id');

        expect(mockCfApi.customHostnames.delete).toHaveBeenCalledWith('cf-123');
      });

      it('should remove hostname from database', async () => {
        await domainsService.deleteCustomHostname('www.example.com', 'test-org-id');

        const hostname = mockDb.hostnames.get('hostname-123');
        expect(hostname?.status).toBe('deleted');
      });

      it('should clear hostname from KV cache', async () => {
        await domainsService.deleteCustomHostname('www.example.com', 'test-org-id');

        expect(mockKv.delete).toHaveBeenCalledWith('host:www.example.com');
      });

      it('should reject if org does not own hostname', async () => {
        await expect(
          domainsService.deleteCustomHostname('www.example.com', 'other-org-id'),
        ).rejects.toThrow(/unauthorized|forbidden/i);
      });

      it('should not allow deleting free subdomain', async () => {
        mockDb.hostnames.set('free-hostname', {
          id: 'free-hostname',
          hostname: 'mybiz.sites.megabyte.space',
          orgId: 'test-org-id',
          isFreeSubdomain: true,
        });

        await expect(
          domainsService.deleteCustomHostname('mybiz.sites.megabyte.space', 'test-org-id'),
        ).rejects.toThrow(/cannot delete|free/i);
      });
    });
  });

  // ==========================================================================
  // SITE HOSTNAMES
  // ==========================================================================
  describe('Site Hostnames', () => {
    describe('getSiteHostnames', () => {
      beforeEach(() => {
        mockDb.hostnames.set('h1', {
          id: 'h1',
          siteId: 'test-site-id',
          hostname: 'mybiz.sites.megabyte.space',
          isFreeSubdomain: true,
          isPrimary: true,
          status: 'active',
        });
        mockDb.hostnames.set('h2', {
          id: 'h2',
          siteId: 'test-site-id',
          hostname: 'www.mybiz.com',
          isFreeSubdomain: false,
          isPrimary: false,
          status: 'active',
        });
      });

      it('should return all hostnames for site', async () => {
        const hostnames = await domainsService.getSiteHostnames('test-site-id');

        expect(hostnames).toHaveLength(2);
        expect(hostnames.map((h) => h.hostname)).toContain('mybiz.sites.megabyte.space');
        expect(hostnames.map((h) => h.hostname)).toContain('www.mybiz.com');
      });

      it('should indicate primary hostname', async () => {
        const hostnames = await domainsService.getSiteHostnames('test-site-id');

        const primary = hostnames.find((h) => h.isPrimary);
        expect(primary).toBeDefined();
        expect(primary?.hostname).toBe('mybiz.sites.megabyte.space');
      });

      it('should return empty array for site with no hostnames', async () => {
        const hostnames = await domainsService.getSiteHostnames('no-hostname-site');

        expect(hostnames).toEqual([]);
      });

      it('should not return deleted hostnames', async () => {
        mockDb.hostnames.set('deleted', {
          id: 'deleted',
          siteId: 'test-site-id',
          hostname: 'old.example.com',
          status: 'deleted',
        });

        const hostnames = await domainsService.getSiteHostnames('test-site-id');

        expect(hostnames.map((h) => h.hostname)).not.toContain('old.example.com');
      });
    });

    describe('getHostnameByDomain', () => {
      beforeEach(() => {
        mockDb.hostnames.set('h1', {
          id: 'h1',
          siteId: 'test-site-id',
          hostname: 'www.example.com',
          status: 'active',
        });
      });

      it('should find hostname by domain', async () => {
        const hostname = await domainsService.getHostnameByDomain('www.example.com');

        expect(hostname).toBeDefined();
        expect(hostname?.hostname).toBe('www.example.com');
      });

      it('should return null for unknown domain', async () => {
        const hostname = await domainsService.getHostnameByDomain('unknown.com');

        expect(hostname).toBeNull();
      });

      it('should check KV cache first', async () => {
        mockKv.cache.set('host:www.example.com', JSON.stringify({
          siteId: 'test-site-id',
          status: 'active',
        }));

        await domainsService.getHostnameByDomain('www.example.com');

        // Should use cached value
        expect(mockKv.get).toHaveBeenCalledWith('host:www.example.com');
      });
    });
  });

  // ==========================================================================
  // HOSTNAME VERIFICATION
  // ==========================================================================
  describe('Hostname Verification', () => {
    describe('verifyPendingHostnames', () => {
      beforeEach(() => {
        mockDb.hostnames.set('pending1', {
          id: 'pending1',
          hostname: 'www.pending1.com',
          status: 'pending',
          cfCustomHostnameId: 'cf-1',
        });
        mockDb.hostnames.set('pending2', {
          id: 'pending2',
          hostname: 'www.pending2.com',
          status: 'pending',
          cfCustomHostnameId: 'cf-2',
        });

        mockCfApi.customHostnames.get
          .mockResolvedValueOnce({
            id: 'cf-1',
            hostname: 'www.pending1.com',
            status: 'active',
            ssl: { status: 'active' },
          })
          .mockResolvedValueOnce({
            id: 'cf-2',
            hostname: 'www.pending2.com',
            status: 'pending',
            ssl: { status: 'pending_validation' },
          });
      });

      it('should check all pending hostnames', async () => {
        const results = await domainsService.verifyPendingHostnames();

        expect(results).toHaveLength(2);
      });

      it('should update status for newly active hostnames', async () => {
        await domainsService.verifyPendingHostnames();

        const hostname1 = mockDb.hostnames.get('pending1');
        expect(hostname1.status).toBe('active');
      });

      it('should update KV cache for active hostnames', async () => {
        await domainsService.verifyPendingHostnames();

        expect(mockKv.put).toHaveBeenCalledWith(
          'host:www.pending1.com',
          expect.any(String),
          expect.any(Object),
        );
      });

      it('should return success/failure status per hostname', async () => {
        const results = await domainsService.verifyPendingHostnames();

        const result1 = results.find((r) => r.hostname === 'www.pending1.com');
        expect(result1?.newStatus).toBe('active');
        expect(result1?.success).toBe(true);

        const result2 = results.find((r) => r.hostname === 'www.pending2.com');
        expect(result2?.newStatus).toBe('pending');
        expect(result2?.success).toBe(false);
      });
    });

    describe('verifyHostname', () => {
      beforeEach(() => {
        mockDb.hostnames.set('hostname-123', {
          id: 'hostname-123',
          hostname: 'www.example.com',
          status: 'pending',
          cfCustomHostnameId: 'cf-123',
        });
      });

      it('should verify single hostname', async () => {
        mockCfApi.customHostnames.get.mockResolvedValue({
          id: 'cf-123',
          hostname: 'www.example.com',
          status: 'active',
          ssl: { status: 'active' },
        });

        const result = await domainsService.verifyHostname('www.example.com');

        expect(result.hostname).toBe('www.example.com');
        expect(result.newStatus).toBe('active');
        expect(result.success).toBe(true);
      });

      it('should return errors for failed verification', async () => {
        mockCfApi.customHostnames.get.mockResolvedValue({
          id: 'cf-123',
          hostname: 'www.example.com',
          status: 'pending',
          ssl: {
            status: 'pending_validation',
            validation_errors: ['CNAME not found'],
          },
        });

        const result = await domainsService.verifyHostname('www.example.com');

        expect(result.success).toBe(false);
        expect(result.errors).toContain('CNAME not found');
      });
    });
  });

  // ==========================================================================
  // DNS VALIDATION
  // ==========================================================================
  describe('DNS Validation', () => {
    describe('validateCnameTarget', () => {
      it('should validate correct CNAME', async () => {
        mockCfApi.dns.resolve.mockResolvedValue({
          records: [{ type: 'CNAME', value: 'sites.megabyte.space' }],
        });

        const result = await domainsService.validateCnameTarget(
          'www.example.com',
          'sites.megabyte.space',
        );

        expect(result.valid).toBe(true);
        expect(result.resolvedTo).toBe('sites.megabyte.space');
      });

      it('should reject incorrect CNAME target', async () => {
        mockCfApi.dns.resolve.mockResolvedValue({
          records: [{ type: 'CNAME', value: 'other-service.com' }],
        });

        const result = await domainsService.validateCnameTarget(
          'www.example.com',
          'sites.megabyte.space',
        );

        expect(result.valid).toBe(false);
        expect(result.resolvedTo).toBe('other-service.com');
      });

      it('should handle DNS resolution failure', async () => {
        mockCfApi.dns.resolve.mockRejectedValue(new Error('DNS lookup failed'));

        const result = await domainsService.validateCnameTarget(
          'www.example.com',
          'sites.megabyte.space',
        );

        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should accept chained CNAME that eventually resolves', async () => {
        // www.example.com -> alias.example.com -> sites.megabyte.space
        mockCfApi.dns.resolve.mockResolvedValue({
          records: [
            { type: 'CNAME', value: 'alias.example.com' },
          ],
          chain: [
            { type: 'CNAME', value: 'sites.megabyte.space' },
          ],
        });

        const result = await domainsService.validateCnameTarget(
          'www.example.com',
          'sites.megabyte.space',
        );

        // Should accept if chain eventually resolves to target
        expect(result.valid).toBe(true);
      });
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================
  describe('Security', () => {
    it('should reject hostname with path traversal attempt', async () => {
      await expect(
        domainsService.createCustomHostname({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          hostname: '../../../etc/passwd.example.com',
        }),
      ).rejects.toThrow(/invalid/i);
    });

    it('should reject hostname with null bytes', async () => {
      await expect(
        domainsService.createCustomHostname({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          hostname: 'www.example.com\x00.evil.com',
        }),
      ).rejects.toThrow(/invalid/i);
    });

    it('should reject excessively long hostnames', async () => {
      const longHostname = 'a'.repeat(256) + '.example.com';

      await expect(
        domainsService.createCustomHostname({
          orgId: 'test-org-id',
          siteId: 'test-site-id',
          hostname: longHostname,
        }),
      ).rejects.toThrow(/too long|invalid/i);
    });

    it('should normalize hostname to lowercase', async () => {
      mockCfApi.customHostnames.create.mockResolvedValue({
        id: 'cf-123',
        hostname: 'www.example.com',
        status: 'pending',
      });

      const result = await domainsService.createCustomHostname({
        orgId: 'test-org-id',
        siteId: 'test-site-id',
        hostname: 'WWW.EXAMPLE.COM',
      });

      expect(result.hostname).toBe('www.example.com');
    });
  });
});
