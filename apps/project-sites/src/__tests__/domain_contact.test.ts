import {
  validateContact,
  formatWhoisContact,
  REQUIRED_FIELDS,
} from '../services/domain_contact.js';

describe('validateContact (domain registration contact gate)', () => {
  it('accepts a complete registrant contact', () => {
    const r = validateContact({
      type: 'registrant',
      name: 'John Doe',
      org: 'Acme Inc',
      email: 'john@acme.com',
      phone: '+1.5551234567',
      address: '123 Main St, Newark, NJ 07102',
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a registrant with all fields empty', () => {
    const r = validateContact({
      type: 'registrant',
      name: '',
      org: '',
      email: '',
      phone: '',
      address: '',
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(5);
    expect(r.errors).toContain('Name is required');
    expect(r.errors).toContain('Organization is required');
    expect(r.errors).toContain('Email is required');
    expect(r.errors).toContain('Phone is required');
    expect(r.errors).toContain('Address is required');
  });

  it('accepts an admin contact with name + email only', () => {
    const r = validateContact({
      type: 'admin',
      name: 'Jane Admin',
      org: '',
      email: 'jane@admin.com',
      phone: '',
      address: '',
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects an admin contact missing name', () => {
    const r = validateContact({
      type: 'admin',
      name: '',
      org: '',
      email: 'jane@admin.com',
      phone: '',
      address: '',
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Name is required');
    expect(r.errors).not.toContain('Email is required');
  });

  it('accepts a tech contact with just email', () => {
    const r = validateContact({
      type: 'tech',
      name: '',
      org: '',
      email: 'noc@example.com',
      phone: '',
      address: '',
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a tech contact with empty email', () => {
    const r = validateContact({
      type: 'tech',
      name: '',
      org: '',
      email: '',
      phone: '',
      address: '',
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Email is required');
  });

  it('accepts a billing contact with just email', () => {
    const r = validateContact({
      type: 'billing',
      name: '',
      org: '',
      email: 'billing@example.com',
      phone: '',
      address: '',
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a billing contact with empty email', () => {
    const r = validateContact({
      type: 'billing',
      name: '',
      org: '',
      email: '   ',
      phone: '',
      address: '',
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Email is required');
    expect(r.errors).toHaveLength(1);
  });

  it('trims whitespace before checking presence', () => {
    const r = validateContact({
      type: 'admin',
      name: '  ',
      org: '',
      email: ' a@b.com ',
      phone: '',
      address: '',
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Name is required');
    expect(r.errors).not.toContain('Email is required');
  });

  it('reports all missing fields at once (registrant)', () => {
    const r = validateContact({
      type: 'registrant',
      name: 'Bob',
      org: '',
      email: '',
      phone: '',
      address: '456 Oak Ave',
    });
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual([
      'Organization is required',
      'Email is required',
      'Phone is required',
    ]);
  });
});

describe('formatWhoisContact (WHOIS-compatible multiline)', () => {
  it('formats a complete registrant contact', () => {
    const result = formatWhoisContact({
      type: 'registrant',
      name: 'Jane Doe',
      org: 'Acme Inc',
      email: 'jane@acme.com',
      phone: '+1.5551234567',
      address: '123 Main St, Newark, NJ 07102',
    });
    expect(result).toBe(
      'Registrant Name: Jane Doe\n' +
        'Registrant Organization: Acme Inc\n' +
        'Registrant Email: jane@acme.com\n' +
        'Registrant Phone: +1.5551234567\n' +
        'Registrant Address: 123 Main St, Newark, NJ 07102\n',
    );
  });

  it('formats a sparse admin contact (only name + email)', () => {
    const result = formatWhoisContact({
      type: 'admin',
      name: 'Jane Admin',
      org: '',
      email: 'jane@admin.com',
      phone: '',
      address: '',
    });
    expect(result).toBe('Admin Name: Jane Admin\n' + 'Admin Email: jane@admin.com\n');
  });

  it('formats a tech contact (email only)', () => {
    const result = formatWhoisContact({
      type: 'tech',
      name: '',
      org: '',
      email: 'noc@example.com',
      phone: '',
      address: '',
    });
    expect(result).toBe('Tech Email: noc@example.com\n');
  });

  it('formats a billing contact with all fields populated', () => {
    const result = formatWhoisContact({
      type: 'billing',
      name: 'Bill Pay',
      org: 'Finance Dept',
      email: 'bills@acme.com',
      phone: '+1.5559876543',
      address: '456 Finance Blvd, Suite 200, Newark, NJ 07102',
    });
    expect(result).toBe(
      'Billing Name: Bill Pay\n' +
        'Billing Organization: Finance Dept\n' +
        'Billing Email: bills@acme.com\n' +
        'Billing Phone: +1.5559876543\n' +
        'Billing Address: 456 Finance Blvd, Suite 200, Newark, NJ 07102\n',
    );
  });

  it('uses the correct role label for each contact type', () => {
    expect(
      formatWhoisContact({
        type: 'registrant',
        name: 'A',
        org: '',
        email: 'a@a.com',
        phone: '',
        address: '',
      }),
    ).toMatch(/^Registrant /);
    expect(
      formatWhoisContact({
        type: 'admin',
        name: 'A',
        org: '',
        email: 'a@a.com',
        phone: '',
        address: '',
      }),
    ).toMatch(/^Admin /);
    expect(
      formatWhoisContact({
        type: 'tech',
        name: 'A',
        org: '',
        email: 'a@a.com',
        phone: '',
        address: '',
      }),
    ).toMatch(/^Tech /);
    expect(
      formatWhoisContact({
        type: 'billing',
        name: 'A',
        org: '',
        email: 'a@a.com',
        phone: '',
        address: '',
      }),
    ).toMatch(/^Billing /);
  });

  it('always ends with a newline', () => {
    const result = formatWhoisContact({
      type: 'registrant',
      name: 'Test',
      org: '',
      email: 't@t.com',
      phone: '',
      address: '',
    });
    expect(result.endsWith('\n')).toBe(true);
  });

  it('outputs fields in canonical order: name, org, email, phone, address', () => {
    const result = formatWhoisContact({
      type: 'registrant',
      name: 'Z',
      org: 'Y',
      email: 'z@y.com',
      phone: '+1',
      address: 'Addr',
    });
    const lines = result.trim().split('\n');
    expect(lines[0]).toMatch(/Name:/);
    expect(lines[1]).toMatch(/Organization:/);
    expect(lines[2]).toMatch(/Email:/);
    expect(lines[3]).toMatch(/Phone:/);
    expect(lines[4]).toMatch(/Address:/);
  });

  it('trims whitespace from field values', () => {
    const result = formatWhoisContact({
      type: 'admin',
      name: '  Jane Admin  ',
      org: '',
      email: '  jane@admin.com  ',
      phone: '',
      address: '',
    });
    expect(result).toContain('Admin Name: Jane Admin');
    expect(result).toContain('Admin Email: jane@admin.com');
  });
});

describe('REQUIRED_FIELDS constant', () => {
  it('defines all four contact roles', () => {
    expect(Object.keys(REQUIRED_FIELDS).sort()).toEqual(['admin', 'billing', 'registrant', 'tech']);
  });

  it('registrant requires all 5 fields', () => {
    expect(REQUIRED_FIELDS.registrant).toEqual(['name', 'org', 'email', 'phone', 'address']);
  });

  it('admin requires name + email', () => {
    expect(REQUIRED_FIELDS.admin).toEqual(['name', 'email']);
  });

  it('tech requires email only', () => {
    expect(REQUIRED_FIELDS.tech).toEqual(['email']);
  });

  it('billing requires email only', () => {
    expect(REQUIRED_FIELDS.billing).toEqual(['email']);
  });
});
