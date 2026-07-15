/**
 * @module libs/features/nl_site_management/service
 *
 * Natural Language Site Management (#5, ROI 2.88) — maps NL commands like
 * "change my hero headline to Best Pizza" to structured site edit intents.
 * Pure regex-based parser, zero I/O, deterministic.
 *
 * Supported commands:
 * - Change/update text: "change hero headline to...", "update about text to..."
 * - Add sections: "add a testimonial section", "add FAQ section"
 * - Remove: "remove the banner", "delete old page"
 * - Update business info: "update phone to...", "change address to..."
 * - Schedule: "add holiday hours for Christmas"
 */
import type { z } from 'zod';

// ── Types ───────────────────────────────────────────────────────────────────

export type EditAction = 'change_text' | 'add_section' | 'remove_element' | 'update_info' | 'unknown';

export interface SiteEditIntent {
  action: EditAction;
  target: string;
  newValue: string;
  page: string;
  confidence: number;
  clarificationNeeded: boolean;
  clarificationQuestion?: string;
}

export interface NlSiteCommand {
  command: string;
  intent: SiteEditIntent;
}

// ── Section targets ─────────────────────────────────────────────────────────

const SECTION_ALIASES: Record<string, string> = {
  hero: 'hero',
  'hero headline': 'hero',
  'hero text': 'hero',
  'main heading': 'hero',
  header: 'hero',
  tagline: 'hero',
  about: 'about',
  'about us': 'about',
  'about section': 'about',
  'our story': 'about',
  services: 'services',
  'service list': 'services',
  'what we do': 'services',
  testimonial: 'testimonials',
  testimonials: 'testimonials',
  reviews: 'testimonials',
  'customer reviews': 'testimonials',
  'what people say': 'testimonials',
  contact: 'contact',
  'contact section': 'contact',
  'get in touch': 'contact',
  'contact form': 'contact',
  footer: 'footer',
  'footer text': 'footer',
  copyright: 'footer',
  faq: 'faq',
  'frequently asked': 'faq',
  'q&a': 'faq',
  'questions section': 'faq',
  pricing: 'pricing',
  'price list': 'pricing',
  rates: 'pricing',
  'menu section': 'pricing',
  hours: 'hours',
  'business hours': 'hours',
  'opening hours': 'hours',
  'store hours': 'hours',
  phone: 'phone',
  'phone number': 'phone',
  'contact phone': 'phone',
  'call us': 'phone',
  address: 'address',
  'business address': 'address',
  location: 'address',
  'our address': 'address',
  email: 'email',
  'email address': 'email',
  'contact email': 'email',
  banner: 'banner',
  announcement: 'banner',
  'top bar': 'banner',
  'promo bar': 'banner',
  holiday: 'holiday_hours',
  'holiday hours': 'holiday_hours',
  'holiday schedule': 'holiday_hours',
  'christmas hours': 'holiday_hours',
};

// ── Command patterns ────────────────────────────────────────────────────────

interface CommandPattern {
  regex: RegExp;
  action: EditAction;
  extractTarget: (match: RegExpMatchArray, cmd: string) => string;
  extractValue: (match: RegExpMatchArray, cmd: string) => string;
  confidence: number;
}

const PATTERNS: CommandPattern[] = [
  // "update phone/address/email to X" — BEFORE general change_text pattern
  {
    regex: /\b(?:update|change|set)\s+(?:my|our|the)\s+(phone|address|email|number)(?:\s+(?:number|address))?\s+to\s+(.+)/i,
    action: 'update_info',
    extractTarget: (m) => m[1]?.trim() ?? 'phone',
    extractValue: (_m) => _m[2]?.trim() ?? '',
    confidence: 0.9,
  },
  // "change X to Y" / "update X to Y" / "set X to Y"
  {
    regex: /\b(?:change|update|set|make|replace)\s+(?:the\s+)?(.+?)\s+to\s+(.+)/i,
    action: 'change_text',
    extractTarget: (m, cmd) => resolveTarget(m[1]?.trim() ?? '', cmd),
    extractValue: (_m) => _m[2]?.trim() ?? '',
    confidence: 0.9,
  },
  // "add a/the X section" / "create a X section"
  {
    regex: /\b(?:add|create|insert|put)\s+(?:a|an|the)\s+(.+?)\s+(?:section|block|page)\b/i,
    action: 'add_section',
    extractTarget: (m) => resolveTarget(m[1]?.trim() ?? '', ''),
    extractValue: () => '',
    confidence: 0.85,
  },
  // "add X to/for Y" / "add holiday hours for Christmas"
  {
    regex: /\badd\s+(.+?)\s+(?:to|for)\s+(.+)/i,
    action: 'add_section',
    extractTarget: (_m, cmd) => resolveTarget(_m[2]?.trim() ?? '', cmd),
    extractValue: (_m, cmd) => cmd,
    confidence: 0.8,
  },
  // "remove/delete the X"
  {
    regex: /\b(?:remove|delete|drop|take\s+down)\s+(?:the\s+)?(.+?)(?:\s+section|\s+page|\s+block)?$/i,
    action: 'remove_element',
    extractTarget: (m) => resolveTarget(m[1]?.trim() ?? '', ''),
    extractValue: () => '',
    confidence: 0.85,
  },
];

// ── Target resolution ───────────────────────────────────────────────────────

function resolveTarget(raw: string, fullCmd: string): string {
  const cleaned = raw.toLowerCase().replace(/[.,!?;:'"]/g, '').trim();

  // Direct match
  if (SECTION_ALIASES[cleaned]) return SECTION_ALIASES[cleaned];

  // Substring match — longest key first to avoid partial matches
  const sortedAliases = Object.entries(SECTION_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, target] of sortedAliases) {
    if (cleaned.includes(alias)) return target;
  }

  // Check full command for context clues — longest key first
  const cmdLower = fullCmd.toLowerCase();
  for (const [alias, target] of sortedAliases) {
    if (cmdLower.includes(alias)) return target;
  }

  // Fallback: return the raw target as a best guess
  return cleaned.replace(/\s+/g, '_').slice(0, 30) || 'unknown';
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Parses a natural language site-editing command into a structured edit intent.
 *
 * Handles: change/update text, add sections, remove elements, update business
 * info. Each intent includes the action type, target section, new value,
 * target page, and confidence score. Low-confidence results include a
 * clarification question.
 *
 * @param command - NL command from the user, e.g. "change my hero headline to Best Pizza"
 * @param currentPage - The page the user is viewing (defaults to homepage).
 * @returns Structured NlSiteCommand with parsed intent.
 */
export function parseSiteCommand(command: string, currentPage = '/'): NlSiteCommand {
  if (!command || command.trim().length < 3) {
    return {
      command,
      intent: {
        action: 'unknown',
        target: '',
        newValue: '',
        page: currentPage,
        confidence: 0,
        clarificationNeeded: true,
        clarificationQuestion: 'What would you like to change? Try: "Change my hero headline to Best Pizza in Brooklyn" or "Add a testimonial section with 3 reviews."',
      },
    };
  }

  let bestMatch: { pattern: CommandPattern; match: RegExpMatchArray } | null = null;

  for (const pattern of PATTERNS) {
    const match = command.match(pattern.regex);
    if (match && (!bestMatch || pattern.confidence > bestMatch.pattern.confidence)) {
      bestMatch = { pattern, match };
    }
  }

  if (!bestMatch) {
    return {
      command,
      intent: {
        action: 'unknown',
        target: '',
        newValue: '',
        page: currentPage,
        confidence: 0.25,
        clarificationNeeded: true,
        clarificationQuestion: 'I did not quite catch that. You can say things like: "Change the hero headline to...", "Add a services section", or "Update my phone number to..."',
      },
    };
  }

  const target = bestMatch.pattern.extractTarget(bestMatch.match, command);
  const newValue = bestMatch.pattern.extractValue(bestMatch.match, command);

  const needsClarification = bestMatch.pattern.confidence < 0.8 || target === 'unknown';

  return {
    command,
    intent: {
      action: bestMatch.pattern.action,
      target,
      newValue,
      page: currentPage,
      confidence: bestMatch.pattern.confidence,
      clarificationNeeded: needsClarification,
      clarificationQuestion: needsClarification
        ? `I think you want to ${bestMatch.pattern.action.replace('_', ' ')} the "${target}" on ${currentPage === '/' ? 'your homepage' : currentPage}. Is that right?`
        : undefined,
    },
  };
}
