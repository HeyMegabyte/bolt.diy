import { DASHBOARD_PERSONA_SYSTEM_PROMPT } from '../prompts/dashboard_persona.js';

describe('DASHBOARD_PERSONA_SYSTEM_PROMPT', () => {
  it('is a substantial non-empty prompt string', () => {
    expect(typeof DASHBOARD_PERSONA_SYSTEM_PROMPT).toBe('string');
    expect(DASHBOARD_PERSONA_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });

  it('contains every required section header (regression guard against a gutted prompt)', () => {
    for (const section of [
      '# VOICE',
      '# HARD RULES',
      '# DATA-LOOKUP FORM',
      '# COMMAND FORM',
      '# DISAGREEMENT FORM',
      '# TONE GUARDRAILS',
      '# WHAT YOU NEVER DO',
    ]) {
      expect(DASHBOARD_PERSONA_SYSTEM_PROMPT).toContain(section);
    }
  });

  it('encodes the load-bearing brevity + tone invariants', () => {
    expect(DASHBOARD_PERSONA_SYSTEM_PROMPT).toMatch(/TWO lines maximum/i);
    expect(DASHBOARD_PERSONA_SYSTEM_PROMPT).toMatch(/no emoji/i);
    expect(DASHBOARD_PERSONA_SYSTEM_PROMPT).toMatch(/bias toward action/i);
  });
});
