import {
  DEFAULT_TEMPLATES,
  extractTemplateVars,
  validateTemplate,
} from '../services/campaign_builder.js';

describe('campaign_builder (LM13 #293 — Listmonk template drafts)', () => {
  describe('DEFAULT_TEMPLATES', () => {
    it('has all 5 campaign kinds present and valid', () => {
      const kinds = [
        'newsletter',
        'changelog',
        'announcement',
        'onboarding',
        'reengagement',
      ] as const;
      for (const kind of kinds) {
        const t = DEFAULT_TEMPLATES[kind];
        expect(t).toBeDefined();
        expect(validateTemplate(t)).toEqual([]);
      }
    });

    it('has no duplicate names across templates', () => {
      const names = Object.values(DEFAULT_TEMPLATES).map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('every template includes business_name in variables', () => {
      for (const t of Object.values(DEFAULT_TEMPLATES)) {
        expect(t.variables).toContain('business_name');
      }
    });

    it('every template has unique variables (no dupes within one template)', () => {
      for (const t of Object.values(DEFAULT_TEMPLATES)) {
        expect(new Set(t.variables).size).toBe(t.variables.length);
      }
    });

    it('newsletter has month and highlights vars', () => {
      const n = DEFAULT_TEMPLATES.newsletter;
      expect(n.variables).toEqual(expect.arrayContaining(['month', 'highlights']));
      expect(n.sendHour).toBe(10);
      expect(n.targetCohort).toBe('active');
    });

    it('changelog has month and changes vars', () => {
      const c = DEFAULT_TEMPLATES.changelog;
      expect(c.variables).toEqual(expect.arrayContaining(['month', 'changes']));
      expect(c.sendHour).toBe(14);
      expect(c.targetCohort).toBe('active');
    });

    it('announcement has announcement_title and cta_url', () => {
      const a = DEFAULT_TEMPLATES.announcement;
      expect(a.variables).toEqual(expect.arrayContaining(['announcement_title', 'cta_url']));
      expect(a.sendHour).toBe(10);
      expect(a.targetCohort).toBe('all');
    });

    it('onboarding has first_name and getting_started_url', () => {
      const o = DEFAULT_TEMPLATES.onboarding;
      expect(o.variables).toEqual(expect.arrayContaining(['first_name', 'getting_started_url']));
      expect(o.sendHour).toBe(9);
      expect(o.targetCohort).toBe('new');
    });

    it('reengagement has months_away and comeback_offer', () => {
      const r = DEFAULT_TEMPLATES.reengagement;
      expect(r.variables).toEqual(expect.arrayContaining(['months_away', 'comeback_offer']));
      expect(r.sendHour).toBe(16);
      expect(r.targetCohort).toBe('churned');
    });
  });

  describe('extractTemplateVars', () => {
    it('extracts unique sorted vars from a template string', () => {
      const result = extractTemplateVars('Hello {{name}}, welcome to {{business_name}}');
      expect(result).toEqual(['business_name', 'name']);
    });

    it('returns unique vars when same var appears multiple times', () => {
      const result = extractTemplateVars('{{x}}{{x}}{{y}}');
      expect(result).toEqual(['x', 'y']);
    });

    it('returns empty array when no vars found', () => {
      expect(extractTemplateVars('no variables here')).toEqual([]);
    });

    it('handles empty string', () => {
      expect(extractTemplateVars('')).toEqual([]);
    });

    it('extracts vars from HTML body templates', () => {
      const n = DEFAULT_TEMPLATES.newsletter;
      const vars = extractTemplateVars(n.bodyTemplate);
      for (const v of n.variables) {
        expect(vars).toContain(v);
      }
    });

    it('extracts vars from text templates', () => {
      const r = DEFAULT_TEMPLATES.reengagement;
      const vars = extractTemplateVars(r.textTemplate);
      for (const v of r.variables) {
        expect(vars).toContain(v);
      }
    });

    it('lower-cases extracted variable names', () => {
      const result = extractTemplateVars('{{UPPER}} {{Mixed_Case}}');
      expect(result).toEqual(['mixed_case', 'upper']);
    });
  });

  describe('validateTemplate', () => {
    it('passes a valid template object', () => {
      const errs = validateTemplate({
        kind: 'newsletter',
        name: 'test',
        subjectTemplate: '{{business_name}} Update',
        bodyTemplate: '<p>{{business_name}}</p>',
        textTemplate: '{{business_name}}',
        variables: ['business_name'],
        sendHour: 10,
        targetCohort: 'active',
      });
      expect(errs).toEqual([]);
    });

    it('rejects null/undefined/number', () => {
      expect(validateTemplate(null)).toEqual(['template must be a non-null object']);
      expect(validateTemplate(undefined)).toEqual(['template must be a non-null object']);
      expect(validateTemplate(42)).toEqual(['template must be a non-null object']);
    });

    it('rejects missing kind', () => {
      const errs = validateTemplate({
        name: 'x',
        subjectTemplate: 'x',
        bodyTemplate: 'x',
        textTemplate: 'x',
        sendHour: 0,
        targetCohort: 'all',
      });
      expect(errs).toContain('missing or invalid kind');
    });

    it('rejects invalid kind', () => {
      const errs = validateTemplate({
        kind: 'spam',
        name: 'x',
        subjectTemplate: 'x',
        bodyTemplate: 'x',
        textTemplate: 'x',
        sendHour: 0,
        targetCohort: 'all',
      });
      expect(errs).toContain('missing or invalid kind');
    });

    it('rejects missing required string fields', () => {
      const errs = validateTemplate({
        kind: 'newsletter',
        sendHour: 10,
      });
      expect(errs).toEqual(
        expect.arrayContaining([
          'missing or empty name',
          'missing or empty subjectTemplate',
          'missing or empty bodyTemplate',
          'missing or empty textTemplate',
          'missing or empty targetCohort',
        ]),
      );
    });

    it('rejects empty required string fields', () => {
      const errs = validateTemplate({
        kind: 'newsletter',
        name: '   ',
        subjectTemplate: '',
        bodyTemplate: '',
        textTemplate: '',
        targetCohort: '',
        sendHour: 10,
      });
      expect(errs).toEqual(
        expect.arrayContaining([
          'missing or empty name',
          'missing or empty subjectTemplate',
          'missing or empty bodyTemplate',
          'missing or empty textTemplate',
          'missing or empty targetCohort',
        ]),
      );
    });

    it('rejects sendHour below 0', () => {
      const errs = validateTemplate({
        kind: 'newsletter',
        name: 'x',
        subjectTemplate: 'x',
        bodyTemplate: 'x',
        textTemplate: 'x',
        sendHour: -1,
        targetCohort: 'active',
      });
      expect(errs).toContain('sendHour must be an integer between 0 and 23');
    });

    it('rejects sendHour above 23', () => {
      const errs = validateTemplate({
        kind: 'newsletter',
        name: 'x',
        subjectTemplate: 'x',
        bodyTemplate: 'x',
        textTemplate: 'x',
        sendHour: 24,
        targetCohort: 'active',
      });
      expect(errs).toContain('sendHour must be an integer between 0 and 23');
    });

    it('rejects non-integer sendHour', () => {
      const errs = validateTemplate({
        kind: 'newsletter',
        name: 'x',
        subjectTemplate: 'x',
        bodyTemplate: 'x',
        textTemplate: 'x',
        sendHour: 10.5,
        targetCohort: 'active',
      });
      expect(errs).toContain('sendHour must be an integer between 0 and 23');
    });

    it('rejects invalid targetCohort', () => {
      const errs = validateTemplate({
        kind: 'newsletter',
        name: 'x',
        subjectTemplate: 'x',
        bodyTemplate: 'x',
        textTemplate: 'x',
        sendHour: 10,
        targetCohort: 'vip',
      });
      expect(errs).toEqual(
        expect.arrayContaining([expect.stringContaining('invalid targetCohort "vip"')]),
      );
    });

    it('rejects non-array variables', () => {
      const errs = validateTemplate({
        kind: 'newsletter',
        name: 'x',
        subjectTemplate: 'x',
        bodyTemplate: 'x',
        textTemplate: 'x',
        sendHour: 10,
        targetCohort: 'active',
        variables: 'not-an-array',
      });
      expect(errs).toContain('variables must be an array');
    });

    it('rejects variables with non-string elements', () => {
      const errs = validateTemplate({
        kind: 'newsletter',
        name: 'x',
        subjectTemplate: 'x',
        bodyTemplate: 'x',
        textTemplate: 'x',
        sendHour: 10,
        targetCohort: 'active',
        variables: ['good', 42],
      });
      expect(errs).toContain('all variables must be strings');
    });
  });
});
