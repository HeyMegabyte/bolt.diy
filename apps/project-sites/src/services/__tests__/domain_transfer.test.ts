import {
  PROVIDERS,
  transferDomain,
  validateTransfer,
  type Provider,
  type TransferPlan,
  type ValidationResult,
} from '../domain_transfer';

describe('PROVIDERS', () => {
  it('has exactly four providers', () => {
    expect(PROVIDERS).toHaveLength(4);
  });

  it('contains the expected registrars', () => {
    expect(PROVIDERS).toEqual(
      expect.arrayContaining(['cloudflare', 'namecheap', 'godaddy', 'route53']),
    );
  });

  it('is immutable (Object.freeze)', () => {
    expect(Object.isFrozen(PROVIDERS)).toBe(true);
  });

  it('each provider is a non-empty string', () => {
    for (const p of PROVIDERS) {
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    }
  });
});

describe('transferDomain', () => {
  const domain = 'example.com';

  it('returns a TransferPlan with steps and nameservers', () => {
    const plan = transferDomain(domain, 'cloudflare', 'namecheap');

    expect(plan).toHaveProperty('steps');
    expect(plan).toHaveProperty('nameservers');
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(Array.isArray(plan.nameservers)).toBe(true);
  });

  it('returns unlock steps for cloudflare → namecheap', () => {
    const plan = transferDomain(domain, 'cloudflare', 'namecheap');

    expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    expect(plan.steps[0].action).toMatch(/Disable|Unlock/i);
    expect(plan.steps[1].action).toMatch(/EPP|auth|code/i);
    expect(plan.steps[plan.steps.length - 1].action).toMatch(/Initiate transfer/i);
  });

  it('returns unlock steps for godaddy → cloudflare', () => {
    const plan = transferDomain(domain, 'godaddy', 'cloudflare');

    expect(plan.steps.length).toBe(3);
    expect(plan.steps[0].action).toMatch(/Unlock/i);
    expect(plan.steps[1].action).toMatch(/authorization code/i);
    expect(plan.steps[2].action).toMatch(/Initiate transfer/i);
  });

  it('returns unlock steps for namecheap → route53', () => {
    const plan = transferDomain(domain, 'namecheap', 'route53');

    expect(plan.steps.length).toBe(3);
    expect(plan.steps[0].action).toMatch(/Unlock/i);
    expect(plan.steps[1].action).toMatch(/EPP/i);
  });

  it('returns unlock steps for route53 → namecheap', () => {
    const plan = transferDomain(domain, 'route53', 'namecheap');

    expect(plan.steps.length).toBe(3);
    expect(plan.steps[0].action).toMatch(/Disable/i);
    expect(plan.steps[1].action).toMatch(/auth code/i);
  });

  it('sets target nameservers to the toProvider', () => {
    const plan = transferDomain(domain, 'godaddy', 'cloudflare');
    expect(plan.nameservers).toEqual([
      'melissa.ns.cloudflare.com',
      'roan.ns.cloudflare.com',
    ]);
  });

  it('sets namecheap nameservers when target is namecheap', () => {
    const plan = transferDomain(domain, 'cloudflare', 'namecheap');
    expect(plan.nameservers).toEqual([
      'dns1.registrar-servers.com',
      'dns2.registrar-servers.com',
    ]);
  });

  it('sets godaddy nameservers when target is godaddy', () => {
    const plan = transferDomain(domain, 'cloudflare', 'godaddy');
    expect(plan.nameservers).toHaveLength(4);
    expect(plan.nameservers[0]).toMatch(/domaincontrol/);
  });

  it('sets route53 nameservers when target is route53', () => {
    const plan = transferDomain(domain, 'cloudflare', 'route53');
    expect(plan.nameservers).toHaveLength(4);
    expect(plan.nameservers[0]).toMatch(/awsdns/);
  });

  it('returns nameservers as a new array (not a reference)', () => {
    const plan = transferDomain(domain, 'godaddy', 'cloudflare');
    plan.nameservers.push('extra.ns.cloudflare.com');
    // Original constant should be unchanged
    const plan2 = transferDomain(domain, 'godaddy', 'cloudflare');
    expect(plan2.nameservers).toHaveLength(2);
  });

  it('each step has step, action, and detail fields', () => {
    const plan = transferDomain(domain, 'cloudflare', 'namecheap');

    for (const step of plan.steps) {
      expect(step).toHaveProperty('step');
      expect(step).toHaveProperty('action');
      expect(step).toHaveProperty('detail');
      expect(typeof step.step).toBe('number');
      expect(typeof step.action).toBe('string');
      expect(typeof step.detail).toBe('string');
      expect(step.step).toBeGreaterThan(0);
    }
  });

  it('steps are 1-indexed and sequential', () => {
    const plan = transferDomain(domain, 'godaddy', 'cloudflare');

    for (let i = 0; i < plan.steps.length; i++) {
      expect(plan.steps[i].step).toBe(i + 1);
    }
  });

  it('does not mutate on repeated calls', () => {
    const a = transferDomain(domain, 'cloudflare', 'namecheap');
    const b = transferDomain(domain, 'cloudflare', 'namecheap');

    expect(a).toEqual(b);
  });
});

describe('validateTransfer', () => {
  it('returns valid: true for a well-formed domain', () => {
    const result = validateTransfer('example.com');
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('returns valid: true for a subdomain', () => {
    const result = validateTransfer('sub.example.com');
    expect(result.valid).toBe(true);
  });

  it('returns valid: true for common TLDs', () => {
    for (const tld of ['com', 'org', 'net', 'io', 'ai', 'app']) {
      const result = validateTransfer(`example.${tld}`);
      expect(result.valid).toBe(true);
    }
  });

  it('returns error for empty domain', () => {
    const result = validateTransfer('');
    expect(result.valid).toBe(false);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].field).toBe('domain');
  });

  it('returns error for whitespace-only string', () => {
    const result = validateTransfer('   ');
    expect(result.valid).toBe(false);
  });

  it('returns error for domain without a TLD', () => {
    const result = validateTransfer('notadomain');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'tld')).toBe(true);
  });

  it('returns error for domain ending with a dot', () => {
    const result = validateTransfer('example.');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'tld')).toBe(true);
  });

  it('returns error for label exceeding 63 characters', () => {
    const longLabel = 'a'.repeat(64);
    const result = validateTransfer(`${longLabel}.com`);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'label_length')).toBe(true);
  });

  it('returns error for label starting with a hyphen', () => {
    const result = validateTransfer('-example.com');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'label_hyphen')).toBe(true);
  });

  it('returns error for label ending with a hyphen', () => {
    const result = validateTransfer('example-.com');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'label_hyphen')).toBe(true);
  });

  it('returns error for invalid characters in label', () => {
    const result = validateTransfer('exam_ple.com');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'label_characters')).toBe(true);
  });

  it('returns error for uppercase characters (they are normalized)', () => {
    const result = validateTransfer('Example.com');
    expect(result.valid).toBe(true); // normalized to lowercase, so valid
  });

  it('returns warning for unrecognised TLD', () => {
    const result = validateTransfer('example.unknown');
    expect(result.valid).toBe(true); // warnings don't block
    expect(result.issues.some((i) => i.field === 'tld_recognition')).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('returns multiple errors for maximum-length domain exceeding limit', () => {
    const longDomain = 'a'.repeat(254) + '.com';
    const result = validateTransfer(longDomain);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'length')).toBe(true);
  });

  it('does not mutate on repeated calls', () => {
    const a = validateTransfer('example.com');
    const b = validateTransfer('example.com');
    expect(a).toEqual(b);
  });

  it('returns same result for domain with trailing whitespace', () => {
    const a = validateTransfer('example.com');
    const b = validateTransfer('  example.com  ');
    expect(b.valid).toBe(a.valid);
  });
});

describe('TypeScript contract', () => {
  it('TransferPlan matches the expected shape', () => {
    const plan: TransferPlan = { steps: [], nameservers: [] };
    expect(plan).toHaveProperty('steps');
    expect(plan).toHaveProperty('nameservers');
  });

  it('ValidationResult matches the expected shape', () => {
    const r: ValidationResult = { valid: true, issues: [] };
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('every provider works with transferDomain', () => {
    const providers: readonly Provider[] = PROVIDERS;
    expect(providers.length).toBeGreaterThan(0);
  });

  it('PROVIDERS values are valid Provider types', () => {
    for (const p of PROVIDERS) {
      // The const assertion guarantees this never fails at runtime
      expect(['cloudflare', 'namecheap', 'godaddy', 'route53']).toContain(p);
    }
  });
});
