/**
 * Voice Site Management (#85, ROI 2.40) — voice command parser for site editing.
 * Maps spoken commands to structured edit intents with confidence scoring.
 * Zero I/O, deterministic.
 */
export type VoiceAction = 'change_text' | 'add_section' | 'remove_section' | 'update_info' | 'publish_site' | 'check_health' | 'unknown';

export interface VoiceIntent {
  action: VoiceAction; target: string; value: string;
  confidence: number; needsConfirmation: boolean;
  verbalConfirmation: string;
}

const COMMANDS: Array<{ pattern: RegExp; action: VoiceAction; extract: (m: RegExpMatchArray) => { target: string; value: string } }> = [
  { pattern: /(?:change|update|set)\s+(?:the\s+)?(?:hero(?:\s+(?:heading|headline|text|title))?|heading|headline|title)\s+to\s+(.+)/i, action: 'change_text', extract: (m) => ({ target: 'hero', value: m[1]?.trim() ?? '' }) },
  { pattern: /(?:change|update)\s+(?:my|our|the)\s+(phone|number|phone number)\s+to\s+(.+)/i, action: 'update_info', extract: (m) => ({ target: 'phone', value: m[2]?.trim() ?? '' }) },
  { pattern: /(?:change|update)\s+(?:my|our|the)\s+(address|location)\s+to\s+(.+)/i, action: 'update_info', extract: (m) => ({ target: 'address', value: m[2]?.trim() ?? '' }) },
  { pattern: /(?:change|update)\s+(?:my|our|the)\s+(hours|business hours|opening hours)\s+to\s+(.+)/i, action: 'update_info', extract: (m) => ({ target: 'hours', value: m[2]?.trim() ?? '' }) },
  { pattern: /add\s+(?:a|an|the)\s+(.+?)\s+(?:section|page|block)\b/i, action: 'add_section', extract: (m) => ({ target: m[1]?.trim() ?? '', value: '' }) },
  { pattern: /add\s+(.+?)\s+(?:to|for)\s+(?:the\s+)?(.+)/i, action: 'add_section', extract: (m) => ({ target: m[2]?.trim() ?? '', value: m[1]?.trim() ?? '' }) },
  { pattern: /(?:remove|delete|take down)\s+(?:the\s+)?(.+?)(?:\s+section|\s+page)?$/i, action: 'remove_section', extract: (m) => ({ target: m[1]?.trim() ?? '', value: '' }) },
  { pattern: /publish\s+(?:the\s+)?(?:site|website|changes)/i, action: 'publish_site', extract: () => ({ target: 'site', value: '' }) },
  { pattern: /(?:check|run|how is)\s+(?:my\s+)?(?:site\s+)?health/i, action: 'check_health', extract: () => ({ target: 'health', value: '' }) },
];

/**
 * Parses a transcribed voice command into a structured edit intent.
 * Voice commands are typically shorter and more conversational than
 * typed commands — the parser accounts for filler words and hesitations.
 */
export function parseVoiceCommand(transcript: string): VoiceIntent {
  const cleaned = transcript.replace(/\b(?:um|uh|er|like|please|thanks|thank you|can you| could you)\b/gi, '').replace(/\s+/g, ' ').trim();

  if (!cleaned || cleaned.length < 3) {
    return { action: 'unknown', target: '', value: '', confidence: 0, needsConfirmation: true, verbalConfirmation: "I didn't catch that. Could you repeat what you'd like to change on your site?" };
  }

  for (const cmd of COMMANDS) {
    const match = cleaned.match(cmd.pattern);
    if (match) {
      const { target, value } = cmd.extract(match);
      const confidence = cmd.action === 'unknown' ? 0.3 : 0.85;
      return {
        action: cmd.action, target, value, confidence,
        needsConfirmation: confidence < 0.8 || cmd.action === 'remove_section' || cmd.action === 'publish_site',
        verbalConfirmation: generateConfirmation(cmd.action, target, value),
      };
    }
  }

  return { action: 'unknown', target: '', value: '', confidence: 0.1, needsConfirmation: true, verbalConfirmation: "I understood you said: '" + transcript + "'. Could you rephrase that as a change? For example: 'Change the hero headline to Best Pizza in Brooklyn.'" };
}

function generateConfirmation(action: VoiceAction, target: string, value: string): string {
  switch (action) {
    case 'change_text': return `Got it. I'll change the ${target} to "${value}". Is that correct?`;
    case 'update_info': return `Understood. I'll update your ${target} to ${value}. Shall I proceed?`;
    case 'add_section': return value ? `I'll add ${value} to the ${target} section. Ready to proceed?` : `I'll add a ${target} section. Does that sound right?`;
    case 'remove_section': return `Are you sure you want to remove the ${target} section? This cannot be undone.`;
    case 'publish_site': return 'Ready to publish your site changes live. Confirm to proceed.';
    case 'check_health': return "Let me check your site's health. One moment.";
    default: return "I'm not sure I understood. Could you try again?";
  }
}
