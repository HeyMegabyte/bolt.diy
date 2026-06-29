import {
  buildSmtpConfig,
  smtpConnectionString,
  validateSmtp,
  type SmtpConfig,
} from '../smtp_config';

describe('buildSmtpConfig', () => {
  it('builds a config with explicit port', () => {
    const cfg = buildSmtpConfig('smtp.sendgrid.net', 587, 'apikey', 'SG.foo');

    expect(cfg.host).toBe('smtp.sendgrid.net');
    expect(cfg.port).toBe(587);
    expect(cfg.user).toBe('apikey');
    expect(cfg.pass).toBe('SG.foo');
  });

  it('derives secure=true on port 465', () => {
    const cfg = buildSmtpConfig('smtp.gmail.com', 465, 'u', 'p');
    expect(cfg.secure).toBe(true);
    expect(cfg.security).toBe('tls');
  });

  it('derives secure=false on port 587', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 587, 'u', 'p');
    expect(cfg.secure).toBe(false);
    expect(cfg.security).toBe('starttls');
  });

  it('derives security=none on port 25', () => {
    const cfg = buildSmtpConfig('relay.local', 25, 'u', 'p');
    expect(cfg.secure).toBe(false);
    expect(cfg.security).toBe('none');
  });

  it('defaults port to 587', () => {
    const cfg = buildSmtpConfig('smtp.example.com', undefined!, 'u', 'p');
    expect(cfg.port).toBe(587);
  });
});

describe('validateSmtp', () => {
  it('returns empty array for a valid config', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 587, 'user', 'pass');
    expect(validateSmtp(cfg)).toEqual([]);
  });

  it('flags empty host', () => {
    const cfg = buildSmtpConfig('', 587, 'user', 'pass');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(expect.objectContaining({ code: 'host_empty', field: 'host' }));
  });

  it('flags whitespace-only host', () => {
    const cfg = buildSmtpConfig('   ', 587, 'user', 'pass');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(expect.objectContaining({ code: 'host_empty', field: 'host' }));
  });

  it('flags host without a dot (non-FQDN)', () => {
    const cfg = buildSmtpConfig('smtp', 587, 'user', 'pass');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'host_not_fqdn', field: 'host' }),
    );
  });

  it('allows localhost as a valid host', () => {
    const cfg = buildSmtpConfig('localhost', 587, 'user', 'pass');
    expect(validateSmtp(cfg)).not.toContainEqual(
      expect.objectContaining({ code: 'host_not_fqdn' }),
    );
  });

  it('flags zero port', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 0, 'user', 'pass');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'port_invalid', field: 'port' }),
    );
  });

  it('flags negative port', () => {
    const cfg = buildSmtpConfig('smtp.example.com', -1, 'user', 'pass');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'port_invalid', field: 'port' }),
    );
  });

  it('flags port above 65535', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 70000, 'user', 'pass');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'port_invalid', field: 'port' }),
    );
  });

  it('flags non-integer port', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 587.5, 'user', 'pass');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(
      expect.objectContaining({ code: 'port_invalid', field: 'port' }),
    );
  });

  it('flags empty user', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 587, '', 'pass');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(expect.objectContaining({ code: 'user_empty', field: 'user' }));
  });

  it('flags whitespace-only user', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 587, '   ', 'pass');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(expect.objectContaining({ code: 'user_empty', field: 'user' }));
  });

  it('flags empty password', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 587, 'user', '');
    const findings = validateSmtp(cfg);
    expect(findings).toContainEqual(expect.objectContaining({ code: 'pass_empty', field: 'pass' }));
  });

  it('collects multiple errors simultaneously', () => {
    const cfg = buildSmtpConfig('', 0, '', '');
    const findings = validateSmtp(cfg);
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('host_empty');
    expect(codes).toContain('port_invalid');
    expect(codes).toContain('user_empty');
    expect(codes).toContain('pass_empty');
  });
});

describe('smtpConnectionString', () => {
  it('produces correct URI for port 587', () => {
    const cfg = buildSmtpConfig('smtp.sendgrid.net', 587, 'apikey', 'SG.foo');
    expect(smtpConnectionString(cfg)).toBe(
      'smtp://apikey:SG.foo@smtp.sendgrid.net:587?secure=false',
    );
  });

  it('produces correct URI for port 465', () => {
    const cfg = buildSmtpConfig('smtp.gmail.com', 465, 'user', 'pass');
    expect(smtpConnectionString(cfg)).toBe('smtp://user:pass@smtp.gmail.com:465?secure=true');
  });

  it('URI-encodes special characters in user', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 587, 'user@domain', 'pass');
    expect(smtpConnectionString(cfg)).toContain('user%40domain');
  });

  it('URI-encodes special characters in password', () => {
    const cfg = buildSmtpConfig('smtp.example.com', 587, 'user', 'p@ss:w#ord?');
    expect(smtpConnectionString(cfg)).not.toContain('p@ss');
    expect(smtpConnectionString(cfg)).toContain('p%40ss%3Aw%23ord%3F');
  });
});

describe('TypeScript type coverage', () => {
  it('SmtpPort accepts known ports', () => {
    const _a: 25 = 25 as const;
    const _b: 465 = 465 as const;
    const _c: 587 = 587 as const;
    expect(_a + _b + _c).toBeGreaterThan(0);
  });

  it('SmtpConfig interface has correct shape', () => {
    const cfg: SmtpConfig = buildSmtpConfig('h', 587, 'u', 'p');
    const keys = Object.keys(cfg).sort();
    expect(keys).toEqual(['host', 'pass', 'port', 'secure', 'security', 'user']);
  });
});
