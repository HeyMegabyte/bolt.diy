/**
 * Unit coverage for services/image_art_direction.ts.
 *
 * Verifies the supreme, ultra-realistic art-direction builder: photographic
 * preamble + negative tail baked into every photo prompt, slot-derived subjects
 * (thin cue → concrete scene, rich cue → grounded in the vertical), landscape
 * framing for heroes, brand-palette weaving, idempotency (no double-wrap), and
 * that brand marks (logo/icon/favicon) pass through untouched.
 */

import {
  ART_DIRECTION_SENTINEL,
  buildArtDirectedPrompt,
  ensureArtDirected,
} from '../services/image_art_direction';

describe('buildArtDirectedPrompt', () => {
  it('bakes in photographic realism + the negative-prompt tail', () => {
    const p = buildArtDirectedPrompt({ subject: 'reception', slot: 'hero', vertical: 'dental' });
    expect(p).toContain('35mm');
    expect(p).toContain('shallow depth of field');
    expect(p).toContain('no watermark');
    expect(p).toContain('Not an illustration');
    expect(p).toContain(ART_DIRECTION_SENTINEL);
  });

  it('derives a slot-specific subject + landscape framing when the cue is thin', () => {
    const p = buildArtDirectedPrompt({ subject: '', slot: 'hero', vertical: 'dental clinic' });
    expect(p).toContain('dental clinic');
    expect(p).toContain('16:9 landscape');
  });

  it('grounds a rich caller cue in the vertical (not a generic stock cue)', () => {
    const p = buildArtDirectedPrompt({
      subject: 'smiling patient in a chair',
      slot: 'section',
      vertical: 'dental clinic',
    });
    expect(p).toContain('smiling patient in a chair');
    expect(p).toContain('dental clinic');
  });

  it('is idempotent — a pre-directed prompt is returned unchanged', () => {
    const once = buildArtDirectedPrompt({ subject: 'x', slot: 'hero', vertical: 'spa' });
    const twice = buildArtDirectedPrompt({ subject: once, slot: 'hero', vertical: 'spa' });
    expect(twice).toBe(once);
  });

  it('leaves brand marks (logo/icon/favicon) untouched', () => {
    expect(buildArtDirectedPrompt({ subject: 'wordmark for Acme', slot: 'logo' })).toBe(
      'wordmark for Acme',
    );
    expect(buildArtDirectedPrompt({ subject: 'square mark', slot: 'favicon' })).toBe('square mark');
  });

  it('weaves in up to four brand-palette accents', () => {
    const p = buildArtDirectedPrompt({
      subject: 'lobby',
      slot: 'hero',
      vertical: 'hotel',
      brandPalette: ['#0ea5e9', 'warm oak'],
    });
    expect(p).toContain('#0ea5e9');
    expect(p).toContain('warm oak');
  });

  it('falls back to a real vertical noun when vertical is missing', () => {
    const p = buildArtDirectedPrompt({ subject: '', slot: 'hero' });
    expect(p).toContain('professional local business');
    expect(p).not.toContain('undefined');
  });

  it('stays well under the DALL-E 4000-char cap', () => {
    const p = buildArtDirectedPrompt({
      subject: 'a very long cue '.repeat(10),
      slot: 'hero',
      vertical: 'restaurant',
      brandPalette: ['#111', '#222', '#333', '#444'],
      businessName: "Tony's Trattoria",
    });
    expect(p.length).toBeLessThan(4000);
  });
});

describe('ensureArtDirected', () => {
  it('is a thin, idempotent wrapper', () => {
    const a = ensureArtDirected('a bright cafe interior', 'hero', 'coffee shop');
    expect(a).toContain('coffee shop');
    expect(ensureArtDirected(a, 'hero', 'coffee shop')).toBe(a);
  });
});
