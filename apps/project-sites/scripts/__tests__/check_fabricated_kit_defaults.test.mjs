// Unit tests for the fabricated-kit-defaults detector (scanForPopulatedArrayDefaults).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanForPopulatedArrayDefaults } from '../check-fabricated-kit-defaults.mjs';

test('flags a multiline populated array @Input() default', () => {
  const src = `
  @Input() tiers: PricingTier[] = [
    { name: 'Starter', price: 0 },
    { name: 'Pro', price: 49 },
  ];`;
  const out = scanForPopulatedArrayDefaults(src);
  assert.equal(out.length, 1);
  assert.equal(out[0].prop, 'tiers');
});

test('flags an inline populated array @Input() default', () => {
  const out = scanForPopulatedArrayDefaults(`@Input() logos: LogoItem[] = [{ name: 'Acme' }];`);
  assert.equal(out.length, 1);
  assert.equal(out[0].prop, 'logos');
});

test('flags a populated string[] default', () => {
  const out = scanForPopulatedArrayDefaults(`@Input() specialties: string[] = ['Cardiology', 'Pediatrics'];`);
  assert.equal(out.length, 1);
  assert.equal(out[0].prop, 'specialties');
});

test('does NOT flag an empty array default []', () => {
  assert.deepEqual(scanForPopulatedArrayDefaults(`@Input() tiers: PricingTier[] = [];`), []);
});

test('does NOT flag an empty array with whitespace/newlines', () => {
  assert.deepEqual(scanForPopulatedArrayDefaults(`@Input() items: FaqItem[] = [\n  ];`), []);
});

test('does NOT flag an object default = {}', () => {
  assert.deepEqual(scanForPopulatedArrayDefaults(`@Input() formData: Record<string,string> = {};`), []);
});

test('does NOT flag a scalar string default (a section label)', () => {
  assert.deepEqual(scanForPopulatedArrayDefaults(`@Input() heading = 'Our Menu';`), []);
});

test('does NOT flag a populated array that is NOT an @Input (e.g. a local const)', () => {
  assert.deepEqual(scanForPopulatedArrayDefaults(`const stars: number[] = [1, 2, 3, 4, 5];`), []);
});

test('catches multiple populated array defaults in one component', () => {
  const src = `
    @Input() groups: FooterGroup[] = [{ heading: 'Product' }];
    @Input() socials: FooterSocial[] = [{ label: 'X' }];
    @Input() legalLinks: FooterLink[] = [];`;
  const out = scanForPopulatedArrayDefaults(src);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((f) => f.prop).sort(), ['groups', 'socials']);
});
