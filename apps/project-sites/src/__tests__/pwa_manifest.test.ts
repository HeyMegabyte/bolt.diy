/**
 * Coverage for the `pwa_manifest_full` flag (STABLE / default-on → LIVE in prod
 * at `GET /api/pwa/manifest`) — previously UNTESTED at both layers.
 *
 *   service (src/services/features.ts: getPwaManifest):
 *     locks the full-PWA completeness contract from the `[[always]]` PWA mandate —
 *     maskable icon, screenshots[] (wide + narrow), shortcuts[], share_target,
 *     file_handlers, protocol_handlers.
 *   route (src/routes/features.ts: GET /api/pwa/manifest):
 *     flag-off 404 (no leak) + flag-on returns the manifest.
 *
 * Only the flag resolver is mocked; the REAL service runs.
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  ...jest.requireActual('../modules/feature_flags/services.js'),
  isFlagOn: jest.fn(),
}));

import features from '../routes/features.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { getPwaManifest } from '../services/features.js';

const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;
const env = {} as never;

describe('getPwaManifest (service) — full-PWA completeness contract', () => {
  const m = getPwaManifest(env, 'demo-org');

  it('declares the core installability fields', () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBeTruthy();
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toMatch(/^#/);
    expect(m.background_color).toMatch(/^#/);
  });

  it('ships a maskable icon at 512px', () => {
    expect(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
  });

  it('ships 3+ screenshots covering BOTH wide and narrow form factors', () => {
    expect(m.screenshots.length).toBeGreaterThanOrEqual(3);
    const factors = new Set(m.screenshots.map((s) => s.form_factor));
    expect(factors.has('wide')).toBe(true);
    expect(factors.has('narrow')).toBe(true);
  });

  it('ships 3+ app shortcuts', () => {
    expect(m.shortcuts.length).toBeGreaterThanOrEqual(3);
    expect(m.shortcuts.every((s) => typeof s.url === 'string')).toBe(true);
  });

  it('declares share_target, file_handlers, and protocol_handlers', () => {
    expect(m.share_target.method).toBe('POST');
    expect(m.share_target.enctype).toBe('multipart/form-data');
    expect(m.file_handlers.length).toBeGreaterThanOrEqual(1);
    expect(m.protocol_handlers.length).toBeGreaterThanOrEqual(1);
    expect(m.protocol_handlers[0].protocol).toMatch(/^web\+/);
  });
});

describe('GET /api/pwa/manifest (route, pwa_manifest_full)', () => {
  it('404s when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await features.request('/api/pwa/manifest', {}, env);
    expect(res.status).toBe(404);
  });

  it('200s with the full manifest when the flag is on', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await features.request('/api/pwa/manifest?org_id=org-9', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { display: string; screenshots: unknown[]; share_target: unknown };
    expect(json.display).toBe('standalone');
    expect(json.screenshots.length).toBeGreaterThanOrEqual(3);
    expect(json.share_target).toBeTruthy();
  });
});
