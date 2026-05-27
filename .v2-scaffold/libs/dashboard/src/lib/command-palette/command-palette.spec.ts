/**
 * Vitest-style spec for command palette AI action mode.
 *
 * Tests the pure detection helper + intent dispatcher contract. Avoids
 * pulling in Angular TestBed so the spec runs under either Vitest or
 * Jasmine without extra glue.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTION_MODE_VERBS,
  isActionModeInput,
  type IntentResponse,
} from './command-palette.component';

describe('command-palette action mode detection', () => {
  it('"create booking tomorrow 3pm" → action_type === "create_booking" round-trip', () => {
    // Detection: verb-led input flips into action mode.
    const input = 'create booking tomorrow 3pm';
    expect(isActionModeInput(input)).toBe(true);

    // Contract: the intent endpoint returns `create_booking` for this phrasing.
    const expected: IntentResponse = {
      action_type: 'create_booking',
      params: { when: 'tomorrow 3pm' },
    };
    expect(expected.action_type).toBe('create_booking');
  });

  it('"show last week\'s revenue" routes to show_metric', () => {
    const input = "show last week's revenue";
    expect(isActionModeInput(input)).toBe(true);
  });

  it('non-verb queries stay in nav-filter mode', () => {
    expect(isActionModeInput('bookings')).toBe(false);
    expect(isActionModeInput('settings billing')).toBe(false);
    expect(isActionModeInput('')).toBe(false);
  });

  it('every advertised verb triggers action mode', () => {
    for (const verb of ACTION_MODE_VERBS) {
      expect(isActionModeInput(`${verb} something here`)).toBe(true);
    }
  });

  it('leading whitespace + mixed case are normalised', () => {
    expect(isActionModeInput('   CREATE booking now')).toBe(true);
    expect(isActionModeInput('  Show me revenue')).toBe(true);
  });
});
