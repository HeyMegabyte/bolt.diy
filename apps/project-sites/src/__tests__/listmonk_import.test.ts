import {
  parseImportRows,
  isValidEmail,
  MAX_IMPORT_ROWS,
  REQUIRED_COLUMNS,
} from '../services/listmonk_import';

describe('listmonk_import', () => {
  // -----------------------------------------------------------------------
  // isValidEmail
  // -----------------------------------------------------------------------
  describe('isValidEmail', () => {
    it('accepts a simple valid email', () => {
      expect(isValidEmail('a@b.co')).toBe(true);
    });

    it('accepts email with plus addressing', () => {
      expect(isValidEmail('user+tag@domain.com')).toBe(true);
    });

    it('accepts email with subdomain', () => {
      expect(isValidEmail('user@sub.example.com')).toBe(true);
    });

    it('rejects empty string', () => {
      expect(isValidEmail('')).toBe(false);
    });

    it('rejects string with no @', () => {
      expect(isValidEmail('notanemail')).toBe(false);
    });

    it('rejects string with no local part', () => {
      expect(isValidEmail('@domain.com')).toBe(false);
    });

    it('rejects string with no domain', () => {
      expect(isValidEmail('user@')).toBe(false);
    });

    it('rejects email with spaces', () => {
      expect(isValidEmail('user @domain.com')).toBe(false);
    });

    it('rejects overly long email (>254 chars)', () => {
      const local = 'a'.repeat(200);
      const domain = 'b'.repeat(60);
      expect(isValidEmail(`${local}@${domain}.com`)).toBe(false);
    });

    it('trims whitespace before checking', () => {
      expect(isValidEmail('  a@b.co  ')).toBe(true);
    });

    it('rejects nullish/undefined via typeof guard', () => {
      expect(isValidEmail(null as unknown as string)).toBe(false);
      expect(isValidEmail(undefined as unknown as string)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // REQUIRED_COLUMNS
  // -----------------------------------------------------------------------
  describe('REQUIRED_COLUMNS', () => {
    it('contains email as the only required column', () => {
      expect(REQUIRED_COLUMNS).toEqual(['email']);
    });
  });

  // -----------------------------------------------------------------------
  // parseImportRows
  // -----------------------------------------------------------------------
  describe('parseImportRows', () => {
    it('returns valid result with subscriber for a single valid row', () => {
      const result = parseImportRows([{ email: 'alice@example.com' }]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.subscribers).toHaveLength(1);
      expect(result.subscribers[0].email).toBe('alice@example.com');
      expect(result.subscribers[0].name).toBe('');
      expect(result.subscribers[0].status).toBe('enabled');
    });

    it('returns valid result with multiple valid rows', () => {
      const rows = [
        { email: 'alice@example.com', name: 'Alice' },
        { email: 'bob@example.com', name: 'Bob' },
        { email: 'carol@example.com', name: 'Carol' },
      ];
      const result = parseImportRows(rows);
      expect(result.valid).toBe(true);
      expect(result.subscribers).toHaveLength(3);
      expect(result.subscribers.map((s) => s.email)).toEqual([
        'alice@example.com',
        'bob@example.com',
        'carol@example.com',
      ]);
    });

    it('reports error when email is missing', () => {
      const result = parseImportRows([{ name: 'No Email' }]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('row 1: missing email');
      expect(result.subscribers).toHaveLength(0);
    });

    it('reports error when email is invalid', () => {
      const result = parseImportRows([{ email: 'not-an-email' }]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("row 1: invalid email 'not-an-email'");
      expect(result.subscribers).toHaveLength(0);
    });

    it('defaults name to empty string when missing', () => {
      const result = parseImportRows([{ email: 'a@b.co' }]);
      expect(result.subscribers[0].name).toBe('');
    });

    it('defaults name to empty string when blank', () => {
      const result = parseImportRows([{ email: 'a@b.co', name: '' }]);
      expect(result.subscribers[0].name).toBe('');
    });

    it('trims name value', () => {
      const result = parseImportRows([{ email: 'a@b.co', name: '  Alice  ' }]);
      expect(result.subscribers[0].name).toBe('Alice');
    });

    it('converts extra columns into attribs', () => {
      const result = parseImportRows([
        {
          email: 'a@b.co',
          name: 'Alice',
          city: 'Newark',
          phone: '555-0100',
        },
      ]);
      expect(result.subscribers[0].attribs).toEqual({
        city: 'Newark',
        phone: '555-0100',
      });
    });

    it('excludes email, name, status from attribs', () => {
      const result = parseImportRows([
        { email: 'a@b.co', name: 'X', status: 'enabled', source: 'web' },
      ]);
      expect(result.subscribers[0].attribs).toEqual({ source: 'web' });
    });

    it('defaults status to enabled', () => {
      const result = parseImportRows([{ email: 'a@b.co' }]);
      expect(result.subscribers[0].status).toBe('enabled');
    });

    it('accepts status as disabled', () => {
      const result = parseImportRows([{ email: 'a@b.co', status: 'disabled' }]);
      expect(result.subscribers[0].status).toBe('disabled');
    });

    it('treats status values other than disabled as enabled', () => {
      const result = parseImportRows([{ email: 'a@b.co', status: 'active' }]);
      expect(result.subscribers[0].status).toBe('enabled');
    });

    it('is case-insensitive on status value', () => {
      const result = parseImportRows([{ email: 'a@b.co', status: 'DISABLED' }]);
      expect(result.subscribers[0].status).toBe('disabled');
    });

    it('reports missing email alongside invalid email in the same batch', () => {
      const rows = [{ email: 'good@example.com' }, { name: 'No Email' }, { email: 'bad' }];
      const result = parseImportRows(rows);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('row 2: missing email');
      expect(result.errors).toContain("row 3: invalid email 'bad'");
      // good row still yields a subscriber
      expect(result.subscribers).toHaveLength(1);
      expect(result.subscribers[0].email).toBe('good@example.com');
    });

    it('reports batch error when exceeding MAX_IMPORT_ROWS', () => {
      const rows = new Array(MAX_IMPORT_ROWS + 1).fill({
        email: 'a@b.co',
      });
      const result = parseImportRows(rows);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('exceeds max import rows (10000)');
      // still processes all individual rows
      expect(result.subscribers).toHaveLength(MAX_IMPORT_ROWS + 1);
    });

    it('returns valid result for empty input', () => {
      const result = parseImportRows([]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.subscribers).toEqual([]);
    });

    it('never throws on any input', () => {
      const cases = [
        [],
        [{ email: 'a@b.co' }],
        [{}],
        [{ email: '' }],
        [{ email: 'bad' }],
        new Array(MAX_IMPORT_ROWS + 5).fill({}),
        [{ email: 'a@b.co', name: 'A', extra1: 'x', extra2: 'y' }],
      ];
      for (const c of cases) {
        expect(() => parseImportRows(c)).not.toThrow();
      }
    });

    it('freezes the returned arrays', () => {
      const result = parseImportRows([{ email: 'a@b.co' }]);
      expect(Object.isFrozen(result.subscribers)).toBe(true);
      expect(Object.isFrozen(result.errors)).toBe(true);
      expect(Object.isFrozen(result.subscribers[0].attribs)).toBe(true);
    });
  });
});
