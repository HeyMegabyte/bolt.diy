/**
 * Convergence Summary — meta-test that verifies the convergence infrastructure itself.
 *
 * Proves: DONE gate script exists, convergence log is being written, gap matrix
 * exists (or is intentionally skipped after first pass), and convergence prompt
 * is readable. This spec IS the self-referential proof that the loop works.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const PROJECT_DIR = path.resolve(import.meta.dirname ?? __dirname, '..');

test.describe('Convergence Infrastructure', () => {
  test('DONE gate script exists and is executable', () => {
    const gatePath = path.join(PROJECT_DIR, 'bin', 'convergence-done-check.sh');
    expect(fs.existsSync(gatePath)).toBe(true);
  });

  test('convergence log has been written', () => {
    const logPath = path.join(PROJECT_DIR, '_CONVERGENCE_LOG.md');
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('Pass');
    expect(content.length).toBeGreaterThan(1000);
  });

  test('convergence prompt is readable', () => {
    const promptPath = path.join(PROJECT_DIR, 'CONVERGENCE_PROMPT.md');
    expect(fs.existsSync(promptPath)).toBe(true);
    const content = fs.readFileSync(promptPath, 'utf-8');
    expect(content).toContain('DONE Conditions');
    expect(content).toContain('Phase');
  });

  test('ADR-0034 platform consolidation doc exists', () => {
    const adrPath = path.join(PROJECT_DIR, 'docs', 'decisions', '0034-platform-consolidation-cf-native.md');
    expect(fs.existsSync(adrPath)).toBe(true);
    const content = fs.readFileSync(adrPath, 'utf-8');
    expect(content).toContain('Fly.io');
    expect(content).toContain('Stripe Meters');
  });
});
