import {
  buildTemplate,
  renderTemplate,
  extractSecrets,
  APP_TEMPLATES,
  type ConfigField,
} from '../services/config_template.js';

describe('config_template', () => {
  // ── buildTemplate ─────────────────────────────────────────────────────────

  describe('buildTemplate', () => {
    it('creates a frozen ConfigTemplate with name, format, and fields', () => {
      const fields: ConfigField[] = [
        { key: 'PORT', value: '8080', description: 'HTTP port', required: true, sensitive: false },
      ];
      const tpl = buildTemplate('MyApp', 'env', fields);
      expect(tpl.name).toBe('MyApp');
      expect(tpl.format).toBe('env');
      expect(tpl.fields).toHaveLength(1);
      expect(tpl.fields[0].key).toBe('PORT');
    });

    it('freezes the returned template and fields array', () => {
      const tpl = buildTemplate('X', 'json', [
        { key: 'A', value: '1', description: '', required: false, sensitive: false },
      ]);
      expect(Object.isFrozen(tpl)).toBe(true);
      expect(Object.isFrozen(tpl.fields)).toBe(true);
    });

    it('copies the fields array (does not share reference)', () => {
      const fields: ConfigField[] = [
        { key: 'K', value: 'v', description: '', required: false, sensitive: false },
      ];
      const tpl = buildTemplate('T', 'toml', fields);
      fields.push({ key: 'K2', value: 'v2', description: '', required: false, sensitive: false });
      expect(tpl.fields).toHaveLength(1);
    });

    it('accepts all four formats', () => {
      for (const fmt of ['env', 'json', 'toml', 'yaml'] as const) {
        const tpl = buildTemplate('F', fmt, []);
        expect(tpl.format).toBe(fmt);
      }
    });
  });

  // ── renderTemplate ───────────────────────────────────────────────────────

  describe('renderTemplate', () => {
    it('renders env format as KEY=VALUE lines', () => {
      const tpl = buildTemplate('E', 'env', [
        { key: 'HOST', value: 'example.com', description: '', required: true, sensitive: false },
        { key: 'PORT', value: '443', description: '', required: true, sensitive: false },
      ]);
      expect(renderTemplate(tpl)).toBe('HOST=example.com\nPORT=443\n');
    });

    it('renders json format as a JSON object', () => {
      const tpl = buildTemplate('J', 'json', [
        { key: 'HOST', value: 'example.com', description: '', required: true, sensitive: false },
        { key: 'PORT', value: '443', description: '', required: true, sensitive: false },
      ]);
      const out = renderTemplate(tpl);
      const parsed = JSON.parse(out);
      expect(parsed).toEqual({ HOST: 'example.com', PORT: '443' });
    });

    it('renders json with an empty array as {}', () => {
      const tpl = buildTemplate('Je', 'json', []);
      expect(renderTemplate(tpl)).toBe('{}');
    });

    it('renders toml format as key = "value" lines', () => {
      const tpl = buildTemplate('T', 'toml', [
        { key: 'HOST', value: 'example.com', description: '', required: true, sensitive: false },
      ]);
      expect(renderTemplate(tpl)).toBe('HOST = "example.com"\n');
    });

    it('renders yaml format as key: "value" lines', () => {
      const tpl = buildTemplate('Y', 'yaml', [
        { key: 'HOST', value: 'example.com', description: '', required: true, sensitive: false },
      ]);
      expect(renderTemplate(tpl)).toBe('HOST: "example.com"\n');
    });

    it('escapes double quotes in json values', () => {
      const tpl = buildTemplate('Q', 'json', [
        { key: 'LABEL', value: 'say "hello"', description: '', required: false, sensitive: false },
      ]);
      const out = renderTemplate(tpl);
      expect(out).toContain('say \\"hello\\"');
      expect(() => JSON.parse(out)).not.toThrow();
    });

    it('escapes double quotes in toml values', () => {
      const tpl = buildTemplate('Qt', 'toml', [
        { key: 'LABEL', value: 'say "hello"', description: '', required: false, sensitive: false },
      ]);
      expect(renderTemplate(tpl)).toContain('\\"hello\\"');
    });

    it('escapes backslashes in json values', () => {
      const tpl = buildTemplate('Bs', 'json', [
        { key: 'PATH', value: 'C:\\apps\\app', description: '', required: false, sensitive: false },
      ]);
      const out = renderTemplate(tpl);
      expect(() => JSON.parse(out)).not.toThrow();
    });
  });

  // ── extractSecrets ───────────────────────────────────────────────────────

  describe('extractSecrets', () => {
    it('returns keys where sensitive is true', () => {
      const fields: ConfigField[] = [
        { key: 'PUBLIC', value: 'x', description: '', required: true, sensitive: false },
        { key: 'SECRET_1', value: 's1', description: '', required: true, sensitive: true },
        { key: 'SECRET_2', value: 's2', description: '', required: false, sensitive: true },
        { key: 'OTHER', value: 'y', description: '', required: false, sensitive: false },
      ];
      expect(extractSecrets(fields)).toEqual(['SECRET_1', 'SECRET_2']);
    });

    it('returns empty array when no sensitive fields', () => {
      expect(extractSecrets([])).toEqual([]);
      expect(
        extractSecrets([
          { key: 'A', value: '1', description: '', required: true, sensitive: false },
        ]),
      ).toEqual([]);
    });
  });

  // ── APP_TEMPLATES ────────────────────────────────────────────────────────

  describe('APP_TEMPLATES', () => {
    it('contains all five service templates', () => {
      expect(Object.keys(APP_TEMPLATES).sort()).toEqual([
        'inngest',
        'listmonk',
        'plane',
        'twenty',
        'unkey',
      ]);
    });

    it('every template has a non-empty name', () => {
      for (const [slug, tpl] of Object.entries(APP_TEMPLATES)) {
        expect(tpl.name).toBeTruthy();
        expect(tpl.format).toMatch(/^(env|json|toml|yaml)$/);
        expect(tpl.fields.length).toBeGreaterThan(0);
      }
    });

    it('every field has a description', () => {
      for (const tpl of Object.values(APP_TEMPLATES)) {
        for (const f of tpl.fields) {
          expect(f.description).toBeTruthy();
        }
      }
    });

    it('every sensitive field has required:true except optional-sensitive', () => {
      for (const tpl of Object.values(APP_TEMPLATES)) {
        for (const f of tpl.fields) {
          if (f.sensitive && !f.required) {
            // Allow optional sensitive fields (observability tokens, OAuth secrets, URLs)
            expect(f.key).toMatch(/SENTRY|LOGTAIL|AMQP|URL$|CLIENT_SECRET/);
          }
        }
      }
    });

    it('at least one sensitive field per template', () => {
      for (const tpl of Object.values(APP_TEMPLATES)) {
        expect(tpl.fields.some((f) => f.sensitive)).toBe(true);
      }
    });

    it('all templates render without throwing', () => {
      for (const tpl of Object.values(APP_TEMPLATES)) {
        expect(() => renderTemplate(tpl)).not.toThrow();
      }
    });

    it('all json templates parse as valid JSON', () => {
      const jsonTpl = Object.values(APP_TEMPLATES).filter((t) => t.format === 'json');
      // none currently, but guard against future additions
      for (const tpl of jsonTpl) {
        expect(() => JSON.parse(renderTemplate(tpl))).not.toThrow();
      }
    });

    it('plane template has required DB_URL and SECRET_KEY', () => {
      const plane = APP_TEMPLATES.plane;
      const keys = plane.fields.map((f) => f.key);
      expect(keys).toContain('PLANE_DB_URL');
      expect(keys).toContain('PLANE_SECRET_KEY');
      expect(keys).toContain('PLANE_ENCRYPTION_KEY');
    });

    it('listmonk template has SMTP_FROM_EMAIL', () => {
      const lm = APP_TEMPLATES.listmonk;
      expect(lm.fields.some((f) => f.key === 'LISTMONK_SMTP_FROM_EMAIL')).toBe(true);
    });

    it('twenty template has STORAGE_TYPE', () => {
      const t = APP_TEMPLATES.twenty;
      expect(t.fields.some((f) => f.key === 'TWENTY_STORAGE_TYPE')).toBe(true);
    });

    it('unkey template has TiDB URL', () => {
      const u = APP_TEMPLATES.unkey;
      expect(u.fields.some((f) => f.key === 'UNKEY_DB_URL')).toBe(true);
    });

    it('inngest template has signing key', () => {
      const i = APP_TEMPLATES.inngest;
      expect(i.fields.some((f) => f.key === 'INNGEST_SIGNING_KEY')).toBe(true);
    });
  });
});
