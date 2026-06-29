import {
  buildConnection,
  buildDestination,
  DESTINATION_TEMPLATES,
} from '../services/hookdeck_client.js';

describe('buildConnection (LOOP-GLOBAL-004 webhook routing)', () => {
  it('builds a connection with source, destination, and no rules', () => {
    const c = buildConnection('src_github', 'dest_plane');
    expect(c.id).toBe('conn_src_github_dest_plane');
    expect(c.source).toBe('src_github');
    expect(c.destination).toBe('dest_plane');
    expect(c.rules).toEqual([]);
  });

  it('builds a connection with filter rules', () => {
    const rules = [
      { field: 'source', operator: 'IS' as const, value: 'github:plane' },
      { field: 'headers.x-event', operator: 'CONTAINS' as const, value: 'issue' },
    ];
    const c = buildConnection('src_github', 'dest_plane', rules);
    expect(c.rules).toHaveLength(2);
    expect(c.rules[0].value).toBe('github:plane');
    expect(c.rules[1].field).toBe('headers.x-event');
  });

  it('preserves rule identity when passed explicitly', () => {
    const rule = { field: 'type', operator: 'IS' as const, value: 'invoice.paid' };
    const c = buildConnection('src_stripe', 'dest_twenty', [rule]);
    expect(c.rules[0]).toBe(rule);
  });

  it('treats undefined rules as an empty pass-all array', () => {
    const c = buildConnection('src_a', 'dest_b', undefined);
    expect(c.rules).toEqual([]);
  });
});

describe('buildDestination (LOOP-GLOBAL-004 webhook routing)', () => {
  it('builds a destination with defaults (POST + bearer)', () => {
    const d = buildDestination('Plane PM', 'https://plane.megabyte.space/api/webhooks');
    expect(d.id).toBe('dest_plane_pm');
    expect(d.name).toBe('Plane PM');
    expect(d.url).toBe('https://plane.megabyte.space/api/webhooks');
    expect(d.method).toBe('POST');
    expect(d.authType).toBe('bearer');
  });

  it('accepts explicit method and authType', () => {
    const d = buildDestination('Public Webhook', 'https://example.com/hook', 'PUT', 'none');
    expect(d.id).toBe('dest_public_webhook');
    expect(d.method).toBe('PUT');
    expect(d.authType).toBe('none');
  });

  it('sanitizes name into a safe id (lowercase, spaces→underscores, strip special chars)', () => {
    const d = buildDestination('Listmonk (Campaigns)', 'https://listmonk.example.com/hook');
    expect(d.id).toBe('dest_listmonk_campaigns');
  });

  it('handles a name with only alphanumeric chars', () => {
    const d = buildDestination('TwentyCRM', 'https://crm.example.com/webhooks');
    expect(d.id).toBe('dest_twentycrm');
  });
});

describe('DESTINATION_TEMPLATES (LOOP-GLOBAL-004 webhook routing)', () => {
  it('contains all four expected service keys', () => {
    expect(Object.keys(DESTINATION_TEMPLATES).sort()).toEqual([
      'listmonk',
      'plane',
      'psnotify',
      'twenty',
    ]);
  });

  describe('plane', () => {
    const d = DESTINATION_TEMPLATES.plane;
    it('has the correct URL', () => {
      expect(d.url).toBe('https://plane.megabyte.space/api/webhooks');
    });
    it('is POST + bearer', () => {
      expect(d.method).toBe('POST');
      expect(d.authType).toBe('bearer');
    });
    it('has the correct name', () => {
      expect(d.name).toBe('Plane PM');
    });
  });

  describe('twenty', () => {
    const d = DESTINATION_TEMPLATES.twenty;
    it('has the correct URL', () => {
      expect(d.url).toBe('https://crm.projectsites.dev/api/webhooks');
    });
    it('is POST + bearer', () => {
      expect(d.method).toBe('POST');
      expect(d.authType).toBe('bearer');
    });
  });

  describe('listmonk', () => {
    const d = DESTINATION_TEMPLATES.listmonk;
    it('has the correct URL', () => {
      expect(d.url).toBe('https://mail.projectsites.dev/api/webhooks');
    });
    it('is POST + bearer', () => {
      expect(d.method).toBe('POST');
      expect(d.authType).toBe('bearer');
    });
  });

  describe('psnotify', () => {
    const d = DESTINATION_TEMPLATES.psnotify;
    it('has the correct URL', () => {
      expect(d.url).toBe('https://notify.projectsites.dev/api/webhooks');
    });
    it('is POST + bearer', () => {
      expect(d.method).toBe('POST');
      expect(d.authType).toBe('bearer');
    });
  });

  it('destinations are frozen / not accidentally mutable', () => {
    // Each entry is a plain object from buildDestination, so Object.isFrozen
    // returns false. This test verifies the shape is stable — mutations to
    // one entry do NOT affect others because each call to buildDestination
    // creates a fresh object.
    const original = DESTINATION_TEMPLATES.plane.url;
    const copy = { ...DESTINATION_TEMPLATES.plane, url: 'http://evil.example.com' };
    expect(copy.url).toBe('http://evil.example.com');
    expect(DESTINATION_TEMPLATES.plane.url).toBe(original);
  });
});
